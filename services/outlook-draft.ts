import { ActivityType, OutlookDraftState, OutreachDraftStatus, TaskKind } from "@/app/generated/prisma/enums";
import { getPrisma } from "@/lib/prisma";
import { outlookAccessToken } from "@/services/outlook-auth";
import { loadOutreachContext, outreachContextFingerprint } from "@/services/outreach-context";
import {
  SIMPLE_ATTACHMENT_LIMIT,
  createOutlookMessageDraft,
  OutlookDraftCreationError,
  removeOutlookDraftMessage,
  safeOutlookLink,
} from "@/services/outlook-graph";
import { checkResumeFile } from "@/services/resume-router";
import { runTaskNow, startTask, TaskBusyError, type TaskHandle } from "@/services/tasks";

const completedStates = new Set<OutlookDraftState>([OutlookDraftState.CREATED, OutlookDraftState.SENT]);

export async function preparedDraft(id: string) {
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

export async function approvalIssue(draft: Awaited<ReturnType<typeof preparedDraft>>) {
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

/**
 * Builds the draft and reports its link, or null with the reason recorded on the draft. Nothing here
 * asks who is calling, so the autopilot can use it from a scan; the page action checks the session.
 * `defer` hands a chunked upload to the runtime after the response; without it the upload runs here.
 */
export async function buildOutlookDraftForJob(id: string, defer?: (run: () => Promise<void>) => void) {
  const draft = await preparedDraft(id);
  const issue = await approvalIssue(draft);
  if (issue) {
    await getPrisma().outreachDraft.update({
      where: { id: draft.id },
      data: { status: OutreachDraftStatus.NEEDS_REVIEW, outlookState: OutlookDraftState.NEEDS_REVIEW, outlookError: issue, approvedAt: null },
    });
    return null;
  }
  if (completedStates.has(draft.outlookState)) return safeOutlookLink(draft.outlookWebLink);

  // A resume that fits one Graph request takes a second or two, so the click can wait for the link
  // and land the user in the draft itself. A chunked upload still goes to the background.
  const resume = await checkResumeFile(draft.attachmentResume.filePath);
  const inline = !defer || Boolean(resume.size && resume.size < SIMPLE_ATTACHMENT_LIMIT);
  let createdLink: string | null = null;

  // The state is claimed synchronously so a second click cannot start a second draft.
  const claimed = await getPrisma().outreachDraft.updateMany({
    where: { id: draft.id, status: OutreachDraftStatus.APPROVED, outlookState: { in: [OutlookDraftState.NOT_CREATED, OutlookDraftState.FAILED, OutlookDraftState.NEEDS_REVIEW] }, outlookMessageId: null },
    data: { outlookState: OutlookDraftState.CREATING, outlookError: null },
  });
  if (claimed.count !== 1) throw new Error("Outlook draft creation is already running or needs manual review.");

  const request = { kind: TaskKind.OUTLOOK_DRAFT, label: "Creating the Outlook draft with your resume", subjectId: id, href: `/jobs/${id}/outreach` };
  try {
    const work = async (task: TaskHandle) => {
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
            ccAddress: draft.ccAddress,
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
              data: { opportunityId: id, type: ActivityType.OUTLOOK_DRAFT_CREATED, description: "Validated Outlook draft created with the selected Resume; it waits in Outlook to be sent." },
            }),
          ]);
          createdLink = safeOutlookLink(external.webLink);
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
    };
    if (inline) await runTaskNow(request, work);
    else await startTask(request, work, defer!);
  } catch (error) {
    if (!(error instanceof TaskBusyError)) throw error;
  }
  return createdLink;
}
