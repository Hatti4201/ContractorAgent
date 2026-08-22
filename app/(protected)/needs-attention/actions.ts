"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@/app/generated/prisma/client";
import {
  ActivityType,
  ApplicationStage,
  FollowUpStatus,
} from "@/app/generated/prisma/enums";
import { requireAuth } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { calendarDate, configuredTimeZone } from "@/services/attention";
import {
  analyzeFollowUpEmail,
  matchFollowUpOpportunity,
  parseFollowUpEvidence,
  proposalForFollowUp,
  type FollowUpAnalysis,
  type FollowUpCandidate,
} from "@/services/follow-up";
import { outlookAccessToken } from "@/services/outlook-auth";
import {
  getOutlookInboxMessage,
  listOutlookInboxMessages,
  type OutlookInboxMessage,
} from "@/services/outlook-graph";

const terminalStages = new Set<ApplicationStage>([
  ApplicationStage.HIRED,
  ApplicationStage.NO_RESPONSE,
  ApplicationStage.REJECTED,
  ApplicationStage.ROLE_CLOSED,
  ApplicationStage.WITHDRAWN,
  ApplicationStage.DUPLICATE,
]);

async function activeCandidates(): Promise<FollowUpCandidate[]> {
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

function analysisInput(message: OutlookInboxMessage, opportunity: FollowUpCandidate | null) {
  return {
    subject: message.subject,
    preview: message.preview,
    receivedAt: message.receivedAt.toISOString(),
    today: calendarDate(new Date(), configuredTimeZone()),
    opportunity: opportunity ? { title: opportunity.title, client: opportunity.client, currentStage: opportunity.currentStage } : null,
  };
}

function suggestionData(message: OutlookInboxMessage, opportunity: FollowUpCandidate | null, analysis: FollowUpAnalysis) {
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

function refresh(opportunityId?: string | null) {
  revalidatePath("/dashboard");
  revalidatePath("/needs-attention");
  if (opportunityId) revalidatePath(`/jobs/${opportunityId}`);
}

export async function syncOutlookFollowUps() {
  await requireAuth();
  let messages: OutlookInboxMessage[];
  try { messages = await listOutlookInboxMessages({ accessToken: await outlookAccessToken() }); } catch {
    redirect("/needs-attention?mail=failed");
  }
  const database = getPrisma();
  const candidates = await activeCandidates();
  const existing = new Set((await database.followUpSuggestion.findMany({
    where: { outlookMessageId: { in: messages.map((message) => message.id) } },
    select: { outlookMessageId: true },
  })).map((row) => row.outlookMessageId));

  let processed = 0;
  for (const message of messages) {
    if (existing.has(message.id) || processed >= 10) continue;
    const match = matchFollowUpOpportunity(message.fromAddress, message.subject, candidates);
    if (!match.relevant) continue;
    processed += 1;
    const opportunity = candidates.find((candidate) => candidate.id === match.opportunityId) ?? null;
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
  refresh();
  redirect("/needs-attention?mail=synced");
}

export async function retryFollowUpSuggestion(id: string) {
  await requireAuth();
  const database = getPrisma();
  const suggestion = await database.followUpSuggestion.findUnique({
    where: { id },
    include: { opportunity: { include: { applicationTrack: true } } },
  });
  if (!suggestion || suggestion.status !== FollowUpStatus.FAILED) throw new Error("This suggestion is not available for retry.");
  try {
    const message = await getOutlookInboxMessage(suggestion.outlookMessageId, { accessToken: await outlookAccessToken() });
    if (message.fromAddress !== suggestion.fromAddress) throw new Error("Outlook sender changed.");
    const opportunity = suggestion.opportunity?.applicationTrack ? {
      id: suggestion.opportunity.id,
      title: suggestion.opportunity.title,
      client: suggestion.opportunity.client,
      recruiterEmail: null,
      currentStage: suggestion.opportunity.applicationTrack.currentStage,
    } : null;
    const analysis = await analyzeFollowUpEmail(analysisInput(message, opportunity));
    await database.followUpSuggestion.update({
      where: { id },
      data: { ...suggestionData(message, opportunity, analysis), status: FollowUpStatus.PENDING, error: null, retryCount: { increment: 1 } },
    });
  } catch {
    await database.followUpSuggestion.update({
      where: { id },
      data: { error: "Email analysis failed. Retry after checking the Outlook and AI connections.", retryCount: { increment: 1 } },
    });
  }
  refresh(suggestion.opportunityId);
}

export async function linkFollowUpSuggestion(id: string, formData: FormData) {
  await requireAuth();
  const opportunityId = formData.get("opportunityId");
  if (typeof opportunityId !== "string" || !opportunityId || opportunityId.length > 100) throw new Error("Select one opportunity.");
  const database = getPrisma();
  const [suggestion, opportunity] = await Promise.all([
    database.followUpSuggestion.findUnique({ where: { id } }),
    database.opportunity.findUnique({ where: { id: opportunityId }, include: { applicationTrack: true } }),
  ]);
  if (!suggestion || suggestion.status !== FollowUpStatus.PENDING || !suggestion.event || suggestion.confidence === null) throw new Error("This suggestion cannot be linked.");
  if (!opportunity?.applicationTrack || terminalStages.has(opportunity.applicationTrack.currentStage)) throw new Error("Select an active opportunity.");
  const analysis: FollowUpAnalysis = {
    event: suggestion.event,
    waitingOn: suggestion.proposedWaitingOn,
    nextAction: suggestion.proposedNextAction,
    nextFollowUpDate: suggestion.proposedNextFollowUpAt?.toISOString().slice(0, 10) ?? null,
    confidence: suggestion.confidence,
    evidence: [],
  };
  const proposal = proposalForFollowUp(analysis, opportunity.applicationTrack.currentStage);
  await database.followUpSuggestion.update({ where: { id }, data: { opportunityId, ...proposal } });
  refresh(opportunityId);
}

export async function confirmFollowUpSuggestion(id: string) {
  await requireAuth();
  let opportunityId: string | null = null;
  await getPrisma().$transaction(async (database) => {
    const suggestion = await database.followUpSuggestion.findUnique({
      where: { id },
      include: { opportunity: { include: { applicationTrack: true } } },
    });
    if (!suggestion?.opportunity?.applicationTrack || suggestion.status !== FollowUpStatus.PENDING || !suggestion.event || suggestion.confidence === null || !parseFollowUpEvidence(suggestion.evidence).length) {
      throw new Error("This suggestion is not ready for confirmation.");
    }
    opportunityId = suggestion.opportunity.id;
    const previousStage = suggestion.opportunity.applicationTrack.currentStage;
    const safeProposal = proposalForFollowUp({
      event: suggestion.event,
      waitingOn: suggestion.proposedWaitingOn,
      nextAction: suggestion.proposedNextAction,
      nextFollowUpDate: suggestion.proposedNextFollowUpAt?.toISOString().slice(0, 10) ?? null,
      confidence: suggestion.confidence,
      evidence: [],
    }, previousStage);
    if (!safeProposal.proposedActivity) throw new Error("This email proposes no CRM change; dismiss it after review.");
    const claimed = await database.followUpSuggestion.updateMany({
      where: { id, status: FollowUpStatus.PENDING },
      data: { status: FollowUpStatus.CONFIRMED, decidedAt: new Date(), proposedActivity: safeProposal.proposedActivity, proposedStage: safeProposal.proposedStage },
    });
    if (claimed.count !== 1) throw new Error("This suggestion was already decided.");
    await database.applicationTrack.update({
      where: { opportunityId },
      data: {
        ...(safeProposal.proposedStage ? { currentStage: safeProposal.proposedStage } : {}),
        waitingOn: suggestion.proposedWaitingOn,
        nextAction: suggestion.proposedNextAction,
        nextFollowUpAt: suggestion.proposedNextFollowUpAt,
        attentionClearedAt: null,
      },
    });
    await database.activity.createMany({ data: [
      {
        opportunityId,
        type: safeProposal.proposedActivity,
        description: `Confirmed Outlook follow-up suggestion ${suggestion.id}.`,
        occurredAt: suggestion.receivedAt,
      },
      ...(safeProposal.proposedStage && safeProposal.proposedStage !== previousStage ? [{
        opportunityId,
        type: ActivityType.STAGE_CHANGED,
        description: `Stage changed from ${previousStage} to ${safeProposal.proposedStage} after human confirmation.`,
      }] : []),
    ] });
  });
  refresh(opportunityId);
}

export async function dismissFollowUpSuggestion(id: string) {
  await requireAuth();
  const result = await getPrisma().followUpSuggestion.updateMany({
    where: { id, status: { in: [FollowUpStatus.PENDING, FollowUpStatus.FAILED] } },
    data: { status: FollowUpStatus.DISMISSED, decidedAt: new Date() },
  });
  if (result.count !== 1) throw new Error("This suggestion was already decided.");
  refresh();
}
