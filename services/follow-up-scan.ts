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
import {
  classifyInboxMessage,
  createIntakeFromMessage,
  intakeBudgetSpent,
  intakeScanMode,
  recordScanDecision,
  shouldImport,
  worthClassifying,
  type ScanMode,
} from "@/services/intake-scan";
import { isDigestMessage } from "@/services/digest";
import { runIntakePipeline } from "@/services/intake-pipeline";
import { sweepSentDrafts } from "@/services/outreach-pipeline";
import { applyFollowUp, followUpAutoEnabled, shouldApplyFollowUp } from "@/services/follow-up-auto";
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

const SCAN_STATE_ID = "primary";

export async function mailScanState() {
  return getPrisma().mailScanState.upsert({
    where: { id: SCAN_STATE_ID },
    create: { id: SCAN_STATE_ID },
    update: {},
  });
}

/**
 * Reads Inbox metadata, keeps only mail that deterministically matches an active opportunity, and
 * records a pending suggestion for each. No CRM business state changes here; confirmation does that.
 *
 * The watermark only advances past messages this run actually decided on, so hitting the per-run
 * analysis cap, or the new-intake budget, defers the remainder to the next scan instead of stepping
 * over it.
 */
/**
 * A message that matches no opportunity may still be a recruiter offering a new role. FR-01 lets the
 * scan turn one into a pending intake. The user confirms it, or with AUTOPILOT=draft the pipeline does
 * when its email passes the hard gates; the mailbox gains at most that Outlook draft, and every
 * judgement is written down so a dry run can be read afterwards and no message is judged twice.
 */
async function considerAsNewIntake(message: OutlookInboxMessage, mode: ScanMode, task?: TaskHandle) {
  if (!worthClassifying(message)) return { classified: false, imported: false };
  const database = getPrisma();
  if (await database.intakeScanDecision.count({ where: { outlookMessageId: message.id } })) {
    return { classified: false, imported: false };
  }

  await task?.progress("Judging a message that matches no job yet");
  const decision = await classifyInboxMessage(message);
  const importing = shouldImport(decision, mode);
  let imported = false;
  if (importing) {
    try {
      const intake = await createIntakeFromMessage(message.id, await outlookAccessToken());
      await runIntakePipeline(intake.id);
      imported = true;
    } catch {
      // The mail stays untouched and the decision still records what was intended.
      imported = false;
    }
  }
  await recordScanDecision(message, {
    ...decision,
    imported,
    reason: importing && !imported ? `${decision.reason} (import failed)` : mode === "dryrun" && decision.isOpportunity ? `${decision.reason} (dry run: not imported)` : decision.reason,
  });
  return { classified: true, imported };
}

export async function scanFollowUps(task?: TaskHandle) {
  const database = getPrisma();
  const state = await mailScanState();
  await database.mailScanState.update({ where: { id: SCAN_STATE_ID }, data: { lastRunAt: new Date() } });

  try {
    await task?.progress("Checking which drafts have been sent");
    // Deterministic and free of model calls: Graph is only asked whether each draft left the folder.
    const accessToken = await outlookAccessToken();
    const archived = await sweepSentDrafts(accessToken);

    await task?.progress("Reading new Outlook mail");
    const messages = await listOutlookInboxMessages({ accessToken }, state.watermark);
    if (!messages.length) {
      await database.mailScanState.update({
        where: { id: SCAN_STATE_ID },
        data: { lastSuccessAt: new Date(), consecutiveFailures: 0, lastError: null },
      });
      return { scanned: 0, analyzed: 0, archived, applied: 0 };
    }

    const candidates = await activeCandidates();
    const seen = new Set((await database.followUpSuggestion.findMany({
      where: { outlookMessageId: { in: messages.map((message) => message.id) } },
      select: { outlookMessageId: true },
    })).map((row) => row.outlookMessageId));

    const scanMode = intakeScanMode();
    const autoFollowUp = followUpAutoEnabled();
    let applied = 0;
    let classified = 0;
    let imported = 0;
    let analyzed = 0;
    let decidedThrough: Date | null = null;
    for (const message of messages) {
      if (analyzed >= MAX_ANALYSES_PER_SCAN) break;
      // Matching is local, so a scan that finds nothing relevant costs no model call at all.
      const match = seen.has(message.id) || isDigestMessage(message)
        ? null
        : matchFollowUpOpportunity(message.fromAddress, message.subject, candidates);
      // Out of intake budget: stop before this message, so the next scan starts with it.
      if (match && !match.relevant && scanMode !== "off" && intakeBudgetSpent(message, { classified, imported })) break;
      decidedThrough = message.receivedAt;
      // Already decided, or the app's own digest, which names jobs but is never a recruiter's mail.
      if (!match) continue;
      if (!match.relevant) {
        if (scanMode !== "off") {
          const outcome = await considerAsNewIntake(message, scanMode, task);
          if (outcome.classified) classified += 1;
          if (outcome.imported) imported += 1;
        }
        continue;
      }
      const opportunity = candidates.find((candidate) => candidate.id === match.opportunityId) ?? null;
      analyzed += 1;
      await task?.progress(`Analyzing message ${analyzed} of at most ${MAX_ANALYSES_PER_SCAN}`);
      try {
        const analysis = await analyzeFollowUpEmail(analysisInput(message, opportunity));
        const created = await database.followUpSuggestion.create({ data: suggestionData(message, opportunity, analysis) });
        // RESTRICTIONS 1.2: the follow-up fields may move on a confident, unambiguous match; the
        // Stage this email also proposes stays pending until the user accepts it.
        if (autoFollowUp && shouldApplyFollowUp(created)) {
          await database.$transaction((transaction) => applyFollowUp(transaction, created.id, { ...created, opportunityId: created.opportunityId! }, message.receivedAt));
          applied += 1;
        }
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

    await database.mailScanState.update({
      where: { id: SCAN_STATE_ID },
      data: {
        ...(decidedThrough ? { watermark: decidedThrough } : {}),
        lastSuccessAt: new Date(),
        consecutiveFailures: 0,
        lastError: null,
      },
    });
    return { scanned: messages.length, analyzed, classified, imported, archived, applied };
  } catch (error) {
    // A scheduled scan runs unattended, so a repeated failure has to stay visible instead of silent.
    await database.mailScanState.update({
      where: { id: SCAN_STATE_ID },
      data: {
        consecutiveFailures: { increment: 1 },
        lastError: (error instanceof Error ? error.message : "The Outlook scan failed.").slice(0, 500),
      },
    });
    throw error;
  }
}
