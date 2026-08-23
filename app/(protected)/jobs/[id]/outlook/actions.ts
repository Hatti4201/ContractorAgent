"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import {
  ActivityType,
  ApplicationStage,
  OutlookDraftState,
  OutreachDraftStatus,
  TaskKind,
} from "@/app/generated/prisma/enums";
import { requireAuth } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { outlookAccessToken } from "@/services/outlook-auth";
import { loadOutreachContext, outreachContextFingerprint } from "@/services/outreach-context";
import {
  createOutlookMessageDraft,
  inspectOutlookSentMessage,
  OutlookDraftCreationError,
  OutlookGraphError,
  removeOutlookDraftMessage,
  validateOutlookSourceMessage,
} from "@/services/outlook-graph";
import { checkResumeFile } from "@/services/resume-router";
import { startTask, TaskBusyError } from "@/services/tasks";

const lockedStates = new Set<OutlookDraftState>([OutlookDraftState.CREATING, OutlookDraftState.CREATED, OutlookDraftState.SENT]);
const completedStates = new Set<OutlookDraftState>([OutlookDraftState.CREATED, OutlookDraftState.SENT]);

async function preparedDraft(id: string) {
  const draft = await getPrisma().outreachDraft.findUnique({
    where: { opportunityId: id },
    include: {
      attachmentResume: true,
      opportunity: { include: { recruiter: true, applicationTrack: true } },
    },
  });
  if (!draft) throw new Error("Outreach draft not found.");
  return draft;
}

async function approvalIssue(draft: Awaited<ReturnType<typeof preparedDraft>>) {
  if (draft.status !== OutreachDraftStatus.APPROVED || !draft.approvedAt) return "Approve the outreach draft before Outlook creation.";
  if (!draft.opportunity.recruiter?.email || draft.toAddress.toLowerCase() !== draft.opportunity.recruiter.email.toLowerCase()) return "Recipient no longer matches the confirmed Recruiter.";
  if (!draft.opportunity.roleFamily || draft.attachmentResume.roleFamily !== draft.opportunity.roleFamily || !draft.attachmentResume.active) return "Selected Resume no longer matches the confirmed Role Family.";
  const file = await checkResumeFile(draft.attachmentResume.filePath);
  if (!file.usable) return file.issue ?? "Selected Resume is unavailable.";
  try {
    if (outreachContextFingerprint(await loadOutreachContext()) !== draft.contextFingerprint) return "Private candidate/outreach context changed; validate the email again.";
  } catch { return "Private candidate/outreach context is unavailable."; }
  return null;
}

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

export async function createOutlookDraft(id: string) {
  await requireAuth();
  const draft = await preparedDraft(id);
  const issue = await approvalIssue(draft);
  if (issue) {
    await getPrisma().outreachDraft.update({
      where: { id: draft.id },
      data: { status: OutreachDraftStatus.NEEDS_REVIEW, outlookState: OutlookDraftState.NEEDS_REVIEW, outlookError: issue, approvedAt: null },
    });
    refresh(id);
    redirect(`/jobs/${id}/outreach`);
  }
  if (completedStates.has(draft.outlookState)) redirect(`/jobs/${id}/outreach`);

  // The state is claimed synchronously so a second click cannot start a second draft, and only the
  // Graph work, which uploads the resume, is handed to the background.
  const claimed = await getPrisma().outreachDraft.updateMany({
    where: { id: draft.id, status: OutreachDraftStatus.APPROVED, outlookState: { in: [OutlookDraftState.NOT_CREATED, OutlookDraftState.FAILED, OutlookDraftState.NEEDS_REVIEW] }, outlookMessageId: null },
    data: { outlookState: OutlookDraftState.CREATING, outlookError: null },
  });
  if (claimed.count !== 1) throw new Error("Outlook draft creation is already running or needs manual review.");

  try {
    await startTask(
      { kind: TaskKind.OUTLOOK_DRAFT, label: "Creating the Outlook draft with your resume", subjectId: id, href: `/jobs/${id}/outreach` },
      async (task) => {
        let accessToken: string;
        try { accessToken = await outlookAccessToken(); } catch {
          await getPrisma().outreachDraft.update({ where: { id: draft.id }, data: { outlookState: OutlookDraftState.FAILED, outlookError: "Outlook connection is unavailable. Reconnect and retry." } });
          throw new Error("Outlook connection is unavailable. Reconnect and retry.");
        }

        let external: Awaited<ReturnType<typeof createOutlookMessageDraft>> | null = null;
        try {
          await task.progress("Uploading and verifying the attachment");
          external = await createOutlookMessageDraft({
            mode: draft.mode,
            toAddress: draft.toAddress,
            subject: draft.subject,
            body: draft.body,
            replySourceMessageId: draft.replySourceMessageId,
            resumePath: draft.attachmentResume.filePath,
          }, { accessToken });
          await getPrisma().$transaction([
            getPrisma().outreachDraft.update({
              where: { id: draft.id },
              data: {
                outlookState: OutlookDraftState.CREATED,
                outlookMessageId: external.id,
                outlookWebLink: external.webLink,
                outlookError: external.verificationWarning,
                outlookDraftRevision: draft.revision,
                outlookDraftCreatedAt: new Date(),
              },
            }),
            getPrisma().activity.create({
              data: { opportunityId: id, type: ActivityType.OUTLOOK_DRAFT_CREATED, description: "Validated Outlook draft created with the selected Resume; user send is still required." },
            }),
          ]);
        } catch (error) {
          if (external) {
            try { await removeOutlookDraftMessage(external.id, { accessToken }); } catch {
              await getPrisma().outreachDraft.update({
                where: { id: draft.id },
                data: { outlookState: OutlookDraftState.NEEDS_REVIEW, outlookMessageId: external.id, outlookWebLink: external.webLink, outlookError: "The Outlook draft was created but local recording failed; review it in Outlook." },
              });
              throw new Error("The Outlook draft was created but local recording failed; review it in Outlook.");
            }
          }
          const creationError = error instanceof OutlookDraftCreationError ? error : null;
          const outlookError = creationError?.message.slice(0, 500) ?? "Outlook draft creation failed; retry or reconnect.";
          await getPrisma().outreachDraft.update({
            where: { id: draft.id },
            data: {
              outlookState: creationError?.orphanedMessageId ? OutlookDraftState.NEEDS_REVIEW : OutlookDraftState.FAILED,
              outlookMessageId: creationError?.orphanedMessageId ?? null,
              outlookWebLink: creationError?.orphanedWebLink ?? null,
              outlookError,
            },
          });
          throw new Error(outlookError);
        }
      },
      after,
    );
  } catch (error) {
    if (!(error instanceof TaskBusyError)) throw error;
  }
  refresh(id);
  redirect(`/jobs/${id}/outreach`);
}

export async function confirmOutlookSent(id: string) {
  await requireAuth();
  const draft = await preparedDraft(id);
  if (draft.outlookState !== OutlookDraftState.CREATED || !draft.outlookMessageId) throw new Error("Create the Outlook draft before confirming send.");
  const messageId = draft.outlookMessageId;

  try {
    await startTask(
      { kind: TaskKind.OUTLOOK_SENT_CHECK, label: "Checking Outlook for the sent message", subjectId: id, href: `/jobs/${id}/outreach` },
      async () => {
        let result: Awaited<ReturnType<typeof inspectOutlookSentMessage>>;
        try {
          result = await inspectOutlookSentMessage(messageId, {
            toAddress: draft.toAddress,
            subject: draft.subject,
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
        if (!result.matchesApprovedRouting) {
          await getPrisma().$transaction([
            getPrisma().outreachDraft.update({ where: { id: draft.id }, data: { outlookState: OutlookDraftState.NEEDS_REVIEW, outlookError: "The sent message recipient, subject, or attachment differs from the approved draft.", sentConfirmedAt: result.sentAt } }),
            getPrisma().activity.create({ data: { opportunityId: id, type: ActivityType.CORRECTION, description: "Outlook reported a sent message that differs from the approved routing; manual review required.", occurredAt: result.sentAt } }),
          ]);
          throw new Error("The sent message differs from the approved draft; review it.");
        }

        await getPrisma().$transaction(async (database) => {
          await database.outreachDraft.update({ where: { id: draft.id }, data: { outlookState: OutlookDraftState.SENT, outlookError: null, sentConfirmedAt: result.sentAt } });
          const stageChanged = draft.opportunity.applicationTrack?.currentStage === ApplicationStage.DISCOVERED;
          if (stageChanged) await database.applicationTrack.update({ where: { opportunityId: id }, data: { currentStage: ApplicationStage.OUTREACH_SENT } });
          await database.activity.createMany({ data: [
            { opportunityId: id, type: ActivityType.OUTREACH_SENT, description: "Outlook confirmed that the user sent the approved draft.", occurredAt: result.sentAt },
            ...(stageChanged ? [{ opportunityId: id, type: ActivityType.STAGE_CHANGED, description: "Stage changed from DISCOVERED to OUTREACH_SENT after Outlook send confirmation.", occurredAt: result.sentAt }] : []),
          ] });
        });
      },
      after,
    );
  } catch (error) {
    if (!(error instanceof TaskBusyError)) throw error;
  }
  refresh(id);
  redirect(`/jobs/${id}/outreach`);
}
