import type { Prisma } from "@/app/generated/prisma/client";
import { ApplicationStage, FollowUpStatus } from "@/app/generated/prisma/enums";
import { getPrisma } from "@/lib/prisma";
import { calendarDate, configuredTimeZone } from "@/services/attention";
import {
  analyzeFollowUpEmail,
  matchFollowUpOpportunity,
  proposalForFollowUp,
  type FollowUpAnalysis,
  type FollowUpCandidate,
} from "@/services/follow-up";
import { outlookAccessToken } from "@/services/outlook-auth";
import { listOutlookInboxMessages, type OutlookInboxMessage } from "@/services/outlook-graph";
import type { TaskHandle } from "@/services/tasks";

// ponytail: ten analyses per scan bounds one run; anything skipped has no row yet, so the next scan retries it.
const MAX_ANALYSES_PER_SCAN = 10;

export const terminalStages = new Set<ApplicationStage>([
  ApplicationStage.HIRED,
  ApplicationStage.NO_RESPONSE,
  ApplicationStage.REJECTED,
  ApplicationStage.ROLE_CLOSED,
  ApplicationStage.WITHDRAWN,
  ApplicationStage.DUPLICATE,
]);

export async function activeCandidates(): Promise<FollowUpCandidate[]> {
  const rows = await getPrisma().opportunity.findMany({
    select: {
      id: true,
      title: true,
      client: true,
      recruiter: { select: { email: true } },
      applicationTrack: { select: { currentStage: true } },
    },
  });
  return rows.flatMap((row) => row.applicationTrack && !terminalStages.has(row.applicationTrack.currentStage) ? [{
    id: row.id,
    title: row.title,
    client: row.client,
    currentStage: row.applicationTrack.currentStage,
    recruiterEmail: row.recruiter?.email ?? null,
  }] : []);
}

export function analysisInput(message: OutlookInboxMessage, opportunity: FollowUpCandidate | null) {
  return {
    subject: message.subject,
    preview: message.preview,
    receivedAt: message.receivedAt.toISOString(),
    today: calendarDate(new Date(), configuredTimeZone()),
    opportunity: opportunity ? { title: opportunity.title, client: opportunity.client, currentStage: opportunity.currentStage } : null,
  };
}

export function suggestionData(message: OutlookInboxMessage, opportunity: FollowUpCandidate | null, analysis: FollowUpAnalysis) {
  return {
    outlookMessageId: message.id,
    opportunityId: opportunity?.id ?? null,
    fromAddress: message.fromAddress,
    subject: message.subject,
    receivedAt: message.receivedAt,
    event: analysis.event,
    ...proposalForFollowUp(analysis, opportunity?.currentStage ?? null),
    confidence: analysis.confidence,
    evidence: analysis.evidence as unknown as Prisma.InputJsonValue,
    analyzedAt: new Date(),
  };
}

/**
 * Reads Inbox metadata, keeps only mail that deterministically matches an active opportunity, and
 * records a pending suggestion for each. No CRM business state changes here; confirmation does that.
 */
export async function scanFollowUps(task?: TaskHandle) {
  await task?.progress("Reading the Outlook inbox");
  const messages = await listOutlookInboxMessages({ accessToken: await outlookAccessToken() });
  const database = getPrisma();
  const candidates = await activeCandidates();
  const seen = new Set((await database.followUpSuggestion.findMany({
    where: { outlookMessageId: { in: messages.map((message) => message.id) } },
    select: { outlookMessageId: true },
  })).map((row) => row.outlookMessageId));

  // Matching is local, so a scan that finds nothing new costs no model call at all.
  const fresh = messages.flatMap((message) => {
    if (seen.has(message.id)) return [];
    const match = matchFollowUpOpportunity(message.fromAddress, message.subject, candidates);
    return match.relevant ? [{ message, opportunity: candidates.find((candidate) => candidate.id === match.opportunityId) ?? null }] : [];
  }).slice(0, MAX_ANALYSES_PER_SCAN);

  let analyzed = 0;
  for (const { message, opportunity } of fresh) {
    analyzed += 1;
    await task?.progress(`Analyzing message ${analyzed} of ${fresh.length}`);
    try {
      const analysis = await analyzeFollowUpEmail(analysisInput(message, opportunity));
      await database.followUpSuggestion.create({ data: suggestionData(message, opportunity, analysis) });
    } catch {
      await database.followUpSuggestion.create({ data: {
        outlookMessageId: message.id,
        opportunityId: opportunity?.id ?? null,
        fromAddress: message.fromAddress,
        subject: message.subject,
        receivedAt: message.receivedAt,
        status: FollowUpStatus.FAILED,
        error: "Email analysis failed. Retry after checking the Outlook and AI connections.",
      } });
    }
  }
  return { scanned: messages.length, analyzed };
}
