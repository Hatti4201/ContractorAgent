import type { Prisma } from "@/app/generated/prisma/client";
import { ActivityType, ApplicationStage, OutlookDraftState, OutreachDraftStatus, TaskKind, TaskStatus } from "@/app/generated/prisma/enums";
import { getPrisma } from "@/lib/prisma";
import { inspectOutlookSentMessage, replyModes } from "@/services/outlook-graph";

/** A draft that exists in Outlook and has not been confirmed sent: the work still waiting on the user. */
export const unsentDraftFilter = {
  outlookMessageId: { not: null },
  outlookState: { in: [OutlookDraftState.CREATED, OutlookDraftState.NEEDS_REVIEW] },
  sentConfirmedAt: null,
} satisfies Prisma.OutreachDraftWhereInput;

const draftSelection = {
  id: true,
  opportunityId: true,
  mode: true,
  subject: true,
  toAddress: true,
  outlookMessageId: true,
  outlookWebLink: true,
  outlookDraftCreatedAt: true,
  attachmentResume: { select: { filePath: true } },
  opportunity: {
    select: {
      title: true,
      recruiter: { select: { name: true } },
      applicationTrack: { select: { currentStage: true } },
    },
  },
} satisfies Prisma.OutreachDraftSelect;

export function listUnsentDrafts(database = getPrisma()) {
  return database.outreachDraft.findMany({
    where: unsentDraftFilter,
    select: draftSelection,
    orderBy: { outlookDraftCreatedAt: "asc" },
  });
}

type UnsentDraft = Awaited<ReturnType<typeof listUnsentDrafts>>[number];

/**
 * Records what Outlook actually sent. The user still sends; this only notices that they did, which is
 * a plain fact from Graph rather than a judgement, so the timer may ask it as well as the button.
 */
export async function archiveIfSent(draft: UnsentDraft, accessToken: string, database = getPrisma()) {
  if (!draft.outlookMessageId) return { sent: false as const };
  const result = await inspectOutlookSentMessage(draft.outlookMessageId, {
    toAddress: draft.toAddress,
    // A reply carries the thread's subject, not one of ours, so there is nothing to compare.
    subject: replyModes.has(draft.mode) ? null : draft.subject,
    resumePath: draft.attachmentResume.filePath,
  }, { accessToken });
  if (!result.sent) return { sent: false as const };

  const { differences } = result;
  const unchecked = result.attachmentChecked ? "" : " The resume file is no longer on disk, so the attachment could not be re-checked.";
  const note = differences.length
    ? `Archived the version you sent from Outlook, which differs from the approved draft (${differences.join(", ")}).${unchecked}`
    : unchecked.trim() || null;
  await database.$transaction(async (transaction) => {
    await transaction.outreachDraft.update({
      where: { id: draft.id },
      data: {
        outlookState: OutlookDraftState.SENT,
        outlookError: note,
        sentConfirmedAt: result.sentAt,
        sentSubject: result.subject,
        sentBody: result.body,
        sentToAddress: result.toAddress,
      },
    });
    const stageChanged = draft.opportunity.applicationTrack?.currentStage === ApplicationStage.DISCOVERED;
    if (stageChanged) {
      await transaction.applicationTrack.update({
        where: { opportunityId: draft.opportunityId },
        data: { currentStage: ApplicationStage.OUTREACH_SENT },
      });
    }
    await transaction.activity.createMany({ data: [
      { opportunityId: draft.opportunityId, type: ActivityType.OUTREACH_SENT, description: "Outlook confirmed the message was sent; the sent version is archived.", occurredAt: result.sentAt },
      ...(differences.length ? [{ opportunityId: draft.opportunityId, type: ActivityType.CORRECTION, description: `The sent message differs from the approved draft (${differences.join(", ")}); the sent version is archived as the record of truth.`, occurredAt: result.sentAt }] : []),
      ...(stageChanged ? [{ opportunityId: draft.opportunityId, type: ActivityType.STAGE_CHANGED, description: "Stage changed from DISCOVERED to OUTREACH_SENT after Outlook send confirmation.", occurredAt: result.sentAt }] : []),
    ] });
  });
  return { sent: true as const, sentAt: result.sentAt };
}

/** Sweeps every waiting draft. Two Graph reads each, no model call, so it can ride the mail scan. */
export async function sweepSentDrafts(accessToken: string, database = getPrisma()) {
  let archived = 0;
  for (const draft of await listUnsentDrafts(database)) {
    try {
      if ((await archiveIfSent(draft, accessToken, database)).sent) archived += 1;
    } catch {
      // Still a draft, or Outlook is briefly unavailable. The next sweep asks again.
    }
  }
  return archived;
}

/** Written but not yet in Outlook: the step between confirming a job and building its draft. */
export async function listDraftsAwaitingOutlook(database = getPrisma()) {
  const drafts = await database.outreachDraft.findMany({
    where: { outlookMessageId: null, outlookState: { not: OutlookDraftState.CREATING } },
    select: {
      id: true,
      opportunityId: true,
      status: true,
      updatedAt: true,
      opportunity: { select: { title: true, recruiter: { select: { name: true } } } },
    },
    orderBy: { updatedAt: "asc" },
  });
  // A job whose email is still being written has no row worth showing yet, so the task speaks for it.
  const writing = new Set((await database.task.findMany({
    where: { kind: TaskKind.OUTREACH_REGENERATE, status: TaskStatus.RUNNING },
    select: { subjectId: true },
  })).flatMap((task) => (task.subjectId ? [task.subjectId] : [])));

  return drafts.map((draft) => ({
    ...draft,
    state: writing.has(draft.opportunityId)
      ? "WRITING" as const
      : draft.status === OutreachDraftStatus.APPROVED ? "READY" as const : "REVIEW" as const,
  }));
}
