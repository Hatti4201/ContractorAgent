"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import {
  ActivityType,
  ApplicationStage,
  OutlookDraftState,
  TaskKind,
} from "@/app/generated/prisma/enums";
import { requireAuth } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { outlookAccessToken } from "@/services/outlook-auth";
import { buildOutlookDraftForJob, preparedDraft } from "@/services/outlook-draft";
import {
  inspectOutlookSentMessage,
  OutlookGraphError,
  replyModes,
  validateOutlookSourceMessage,
} from "@/services/outlook-graph";
import { runTaskNow, TaskBusyError } from "@/services/tasks";

const lockedStates = new Set<OutlookDraftState>([OutlookDraftState.CREATING, OutlookDraftState.CREATED, OutlookDraftState.SENT]);
// NEEDS_REVIEW is included so a message flagged earlier still has a way to be checked and archived.
const sentCheckStates = new Set<OutlookDraftState>([OutlookDraftState.CREATED, OutlookDraftState.NEEDS_REVIEW]);

function refresh(id: string) {
  revalidatePath("/dashboard");
  revalidatePath("/needs-attention");
  revalidatePath(`/jobs/${id}`);
  revalidatePath(`/jobs/${id}/outreach`);
}

export async function selectOutlookReplySource(id: string, formData: FormData) {
  await requireAuth();
  const draft = await preparedDraft(id);
  if (lockedStates.has(draft.outlookState)) throw new Error("The Outlook draft is already locked.");
  const sourceId = formData.get("sourceMessageId");
  if (typeof sourceId !== "string" || !sourceId || sourceId.length > 20_000) throw new Error("Select one Outlook message.");
  const recruiterEmail = draft.opportunity.recruiter?.email;
  if (!recruiterEmail) throw new Error("Confirmed Recruiter email is missing.");
  let confirmedId: string;
  try { confirmedId = await validateOutlookSourceMessage(sourceId, recruiterEmail, { accessToken: await outlookAccessToken() }); } catch {
    await getPrisma().outreachDraft.update({ where: { id: draft.id }, data: { outlookState: OutlookDraftState.FAILED, outlookError: "The selected Outlook message could not be verified. Reconnect and choose it again." } });
    refresh(id);
    redirect(`/jobs/${id}/outreach`);
  }
  await getPrisma().outreachDraft.update({
    where: { id: draft.id },
    data: { replySourceMessageId: confirmedId, outlookState: OutlookDraftState.NOT_CREATED, outlookError: null },
  });
  refresh(id);
  redirect(`/jobs/${id}/outreach`);
}

/**
 * Builds the draft and reports its link, or null with the reason recorded on the draft. Callers
 * decide what to do with the link: the page navigates, the review screen hands it to a tab it
 * opened inside the click, which is the only kind Outlook is allowed to close again after Send.
 */
export async function buildOutlookDraft(id: string) {
  await requireAuth();
  const link = await buildOutlookDraftForJob(id, after);
  refresh(id);
  return link;
}

/** The outreach page button. Its caller is already on the job, so only the link travels back. */
export async function createOutlookDraftLink(id: string) {
  return { url: await buildOutlookDraft(id) };
}

export async function confirmOutlookSent(id: string) {
  await requireAuth();
  const draft = await preparedDraft(id);
  if (!sentCheckStates.has(draft.outlookState) || !draft.outlookMessageId) {
    await getPrisma().outreachDraft.update({ where: { id: draft.id }, data: { outlookError: "Create the Outlook draft before confirming send." } });
    refresh(id);
    redirect(`/jobs/${id}/outreach`);
  }
  const messageId = draft.outlookMessageId;
  let archived = false;

  try {
    // Runs in the request, not after it: a couple of Graph reads, and the verdict decides where you land.
    await runTaskNow(
      { kind: TaskKind.OUTLOOK_SENT_CHECK, label: "Checking Outlook for the sent message", subjectId: id, href: `/jobs/${id}/outreach` },
      async () => {
        let result: Awaited<ReturnType<typeof inspectOutlookSentMessage>>;
        try {
          result = await inspectOutlookSentMessage(messageId, {
            toAddress: draft.toAddress,
            // A reply's subject belongs to the thread, so there is nothing of ours to compare.
            subject: replyModes.has(draft.mode) ? null : draft.subject,
            resumePath: draft.attachmentResume.filePath,
          }, { accessToken: await outlookAccessToken() });
        } catch (error) {
          const message = error instanceof OutlookGraphError && error.status === 404
            ? "Outlook does not expose the message yet. Sent Items can take time to update; retry in 30 seconds."
            : "Outlook send verification is temporarily unavailable. Reconnect or retry shortly.";
          await getPrisma().outreachDraft.update({ where: { id: draft.id }, data: { outlookError: message } });
          throw new Error(message);
        }

        if (!result.sent) {
          await getPrisma().outreachDraft.update({ where: { id: draft.id }, data: { outlookError: "Outlook still reports this item as a draft. Send it manually, then check again." } });
          throw new Error("Outlook still reports this item as a draft. Send it manually, then check again.");
        }
        // The user is the sender, so what left the mailbox wins; a difference is recorded, never rejected.
        const differences = result.differences;
        const note = differences.length ? `Archived the version you sent from Outlook, which differs from the approved draft (${differences.join(", ")}).` : null;
        await getPrisma().$transaction(async (database) => {
          await database.outreachDraft.update({
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
          if (stageChanged) await database.applicationTrack.update({ where: { opportunityId: id }, data: { currentStage: ApplicationStage.OUTREACH_SENT } });
          await database.activity.createMany({ data: [
            { opportunityId: id, type: ActivityType.OUTREACH_SENT, description: "Outlook confirmed the user sent the message; the sent version is archived.", occurredAt: result.sentAt },
            ...(differences.length ? [{ opportunityId: id, type: ActivityType.CORRECTION, description: `The sent message differs from the approved draft (${differences.join(", ")}); the sent version is archived as the record of truth.`, occurredAt: result.sentAt }] : []),
            ...(stageChanged ? [{ opportunityId: id, type: ActivityType.STAGE_CHANGED, description: "Stage changed from DISCOVERED to OUTREACH_SENT after Outlook send confirmation.", occurredAt: result.sentAt }] : []),
          ] });
        });
        archived = true;
      },
    );
  } catch (error) {
    if (!(error instanceof TaskBusyError)) throw error;
  }
  refresh(id);
  // A confirmed send is the end of this job's outreach work; anything else stays here with its banner.
  redirect(archived ? `/dashboard?sent=${id}` : `/jobs/${id}/outreach`);
}
