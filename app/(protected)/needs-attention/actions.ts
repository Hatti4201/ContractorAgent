"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { ActivityType, FollowUpStatus, TaskKind } from "@/app/generated/prisma/enums";
import { requireAuth } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import {
  analyzeFollowUpEmail,
  parseFollowUpEvidence,
  proposalForFollowUp,
  type FollowUpAnalysis,
} from "@/services/follow-up";
import { analysisInput, scanFollowUps, suggestionData, terminalStages } from "@/services/follow-up-scan";
import { outlookAccessToken } from "@/services/outlook-auth";
import { getOutlookInboxMessage } from "@/services/outlook-graph";
import { startTask, TaskBusyError } from "@/services/tasks";

function refresh(opportunityId?: string | null) {
  revalidatePath("/dashboard");
  revalidatePath("/needs-attention");
  if (opportunityId) revalidatePath(`/jobs/${opportunityId}`);
}

export async function syncOutlookFollowUps() {
  await requireAuth();
  try {
    // Up to ten model calls run in sequence here, so the page never waits for them.
    await startTask(
      { kind: TaskKind.FOLLOW_UP_SCAN, label: "Scanning Outlook for recruiter follow-ups", subjectId: "follow-up-scan", href: "/needs-attention" },
      (task) => scanFollowUps(task).then(() => undefined),
      after,
    );
  } catch (error) {
    if (!(error instanceof TaskBusyError)) throw error;
  }
  refresh();
  redirect("/needs-attention?mail=started");
}

export async function retryFollowUpSuggestion(id: string) {
  await requireAuth();
  const database = getPrisma();
  const suggestion = await database.followUpSuggestion.findUnique({ where: { id }, select: { id: true, status: true, opportunityId: true } });
  if (!suggestion || suggestion.status !== FollowUpStatus.FAILED) throw new Error("This suggestion is not available for retry.");

  try {
    await startTask(
      { kind: TaskKind.FOLLOW_UP_RETRY, label: "Re-analyzing that recruiter email", subjectId: id, href: "/needs-attention" },
      async () => {
        const current = await database.followUpSuggestion.findUniqueOrThrow({
          where: { id },
          include: { opportunity: { include: { applicationTrack: true } } },
        });
        try {
          const message = await getOutlookInboxMessage(current.outlookMessageId, { accessToken: await outlookAccessToken() });
          if (message.fromAddress !== current.fromAddress) throw new Error("Outlook sender changed.");
          const opportunity = current.opportunity?.applicationTrack ? {
            id: current.opportunity.id,
            title: current.opportunity.title,
            client: current.opportunity.client,
            recruiterEmail: null,
            currentStage: current.opportunity.applicationTrack.currentStage,
          } : null;
          const analysis = await analyzeFollowUpEmail(analysisInput(message, opportunity));
          await database.followUpSuggestion.update({
            where: { id },
            data: { ...suggestionData(message, opportunity, analysis), status: FollowUpStatus.PENDING, error: null, retryCount: { increment: 1 } },
          });
        } catch (error) {
          await database.followUpSuggestion.update({
            where: { id },
            data: { error: "Email analysis failed. Retry after checking the Outlook and AI connections.", retryCount: { increment: 1 } },
          });
          throw error;
        }
      },
      after,
    );
  } catch (error) {
    if (!(error instanceof TaskBusyError)) throw error;
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
