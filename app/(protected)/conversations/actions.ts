"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { runTaskNow, startTask, TaskBusyError } from "@/services/tasks";
import { syncOutlookConversations } from "@/services/conversation-sync";
import { TaskKind } from "@/app/generated/prisma/enums";
import { outlookAccessToken, outlookSendToken } from "@/services/outlook-auth";
import { readOutlookInboxMessage, sendOutlookReply } from "@/services/outlook-graph";
import { createIntakeFromMessage } from "@/services/intake-scan";
import { runIntakePipeline } from "@/services/intake-pipeline";
import { startOutreachDraftGeneration } from "@/app/(protected)/jobs/[id]/outreach/actions";
import { safeOutlookLink } from "@/services/outlook-graph";

export async function syncConversationsAction() {
  await requireAuth();
  try {
    await startTask({ kind: TaskKind.FOLLOW_UP_SCAN, label: "Syncing Outlook conversations", subjectId: "conversation-sync", href: "/conversations" }, (task) => syncOutlookConversations(task, true).then(() => undefined), after);
  } catch (error) { if (!(error instanceof TaskBusyError)) throw error; }
  revalidatePath("/conversations");
}

export async function setConversationScanEnabled(formData: FormData) {
  await requireAuth();
  const enabled = formData.get("enabled") === "true";
  await getPrisma().mailScanState.upsert({ where: { id: "primary" }, create: { id: "primary", autoScanEnabled: enabled }, update: { autoScanEnabled: enabled } });
  revalidatePath("/conversations");
}

/** A user click is the approval boundary: the generated reply never sends from the scan itself. */
export async function sendConversationReply(messageId: string) {
  await requireAuth();
  const database = getPrisma();
  const message = await database.conversationMessage.findUnique({
    where: { id: messageId },
    select: { id: true, outlookMessageId: true, direction: true, replyDraft: true, replySentAt: true },
  });
  if (!message || message.direction !== "incoming" || !message.replyDraft || message.replySentAt) throw new Error("This recruiter reply is no longer waiting to be sent.");

  const now = new Date();
  // A crashed send can be retried after 15 minutes; the user should check Sent Items first if
  // Outlook may have accepted the request before the app lost the response.
  const claimed = await database.conversationMessage.updateMany({
    where: {
      id: message.id,
      replySentAt: null,
      replyDraft: { not: null },
      OR: [{ replySendingAt: null }, { replySendingAt: { lt: new Date(now.getTime() - 15 * 60_000) } }],
    },
    data: { replySendingAt: now, replySendError: null },
  });
  if (claimed.count !== 1) throw new Error("This recruiter reply is already being sent or was sent.");

  try {
    await sendOutlookReply(message.outlookMessageId, message.replyDraft, { accessToken: await outlookSendToken() });
    await database.conversationMessage.update({ where: { id: message.id }, data: { replySentAt: new Date(), replySendingAt: null, replySendError: null } });
  } catch (error) {
    const reason = (error instanceof Error ? error.message : "Outlook could not send this reply.").slice(0, 500);
    await database.conversationMessage.update({ where: { id: message.id }, data: { replySendingAt: null, replySendError: reason } }).catch(() => {});
    throw new Error(reason);
  }
  revalidatePath("/conversations");
  revalidatePath("/needs-attention");
}

export async function openConversationMessage(messageId: string) {
  await requireAuth();
  const message = await getPrisma().conversationMessage.findUnique({ where: { id: messageId }, select: { outlookMessageId: true } });
  if (!message) throw new Error("This Outlook message is no longer available.");
  const outlookMessage = await readOutlookInboxMessage(message.outlookMessageId, { accessToken: await outlookAccessToken() });
  const url = safeOutlookLink(outlookMessage.webLink ?? null);
  if (!url) throw new Error("Outlook did not return a safe link for this message.");
  return { url };
}

export async function addConversationToPipeline(messageId: string) {
  await requireAuth();
  const database = getPrisma();
  const message = await database.conversationMessage.findUnique({ where: { id: messageId }, select: { outlookMessageId: true, conversationId: true, direction: true } });
  if (!message || message.direction !== "incoming") throw new Error("Select an incoming recruiter message.");
  const existing = await database.jobIntake.findUnique({ where: { sourceMessageId: message.outlookMessageId }, select: { id: true } });
  const intakeId = existing?.id ?? (await createIntakeFromMessage(message.outlookMessageId, await outlookAccessToken())).id;
  try {
    await startTask({ kind: TaskKind.INTAKE_PIPELINE, label: "Running recruiter email through autopilot", subjectId: intakeId, href: "/conversations" }, async (task) => {
      await runIntakePipeline(intakeId, task);
      const intake = await database.jobIntake.findUnique({ where: { id: intakeId }, select: { opportunityId: true } });
      if (intake?.opportunityId) await database.conversationJob.upsert({ where: { conversationId_opportunityId: { conversationId: message.conversationId, opportunityId: intake.opportunityId } }, create: { conversationId: message.conversationId, opportunityId: intake.opportunityId }, update: {} });
    }, after);
  } catch (error) { if (!(error instanceof TaskBusyError)) throw error; }
  revalidatePath("/conversations");
  revalidatePath("/autopilot");
}

/** Runs one recruiter email through Draft mode immediately, then returns its Outlook draft link. */
export async function processConversationMessage(messageId: string) {
  await requireAuth();
  const database = getPrisma();
  const message = await database.conversationMessage.findUnique({ where: { id: messageId }, select: { outlookMessageId: true, conversationId: true, direction: true } });
  if (!message || message.direction !== "incoming") throw new Error("Select an incoming recruiter message.");
  const existing = await database.jobIntake.findUnique({ where: { sourceMessageId: message.outlookMessageId }, select: { id: true } });
  const intakeId = existing?.id ?? (await createIntakeFromMessage(message.outlookMessageId, await outlookAccessToken())).id;
  let taskId: string;
  try {
    taskId = await runTaskNow({ kind: TaskKind.INTAKE_PIPELINE, label: "Priority recruiter email → Outlook draft", subjectId: intakeId, href: "/conversations" }, (task) => runIntakePipeline(intakeId, task, "shadow"));
  } catch (error) {
    if (error instanceof TaskBusyError) throw new Error("This email is already being processed.");
    throw error;
  }
  const task = await database.task.findUnique({ where: { id: taskId }, select: { status: true, error: true } });
  const intake = await database.jobIntake.findUnique({ where: { id: intakeId }, select: { opportunityId: true } });
  if (task?.status === "FAILED" || !intake?.opportunityId) throw new Error(task?.error ?? "The email did not pass the pipeline checks, so no draft was created.");
  await database.conversationJob.upsert({ where: { conversationId_opportunityId: { conversationId: message.conversationId, opportunityId: intake.opportunityId } }, create: { conversationId: message.conversationId, opportunityId: intake.opportunityId }, update: {} });
  const draft = await database.outreachDraft.findUnique({ where: { opportunityId: intake.opportunityId }, select: { outlookWebLink: true } });
  const url = safeOutlookLink(draft?.outlookWebLink ?? null);
  if (!url) throw new Error("The draft was not created in Outlook. Check the Outlook connection and try again.");
  revalidatePath("/conversations");
  revalidatePath("/autopilot");
  return { url };
}

export async function addExistingJobToPipeline(opportunityId: string, messageId: string) {
  await requireAuth();
  const database = getPrisma();
  const message = await database.conversationMessage.findUnique({ where: { id: messageId }, select: { outlookMessageId: true, conversationId: true, direction: true } });
  if (!message || message.direction !== "incoming") throw new Error("Select an incoming recruiter message.");
  await database.conversationJob.upsert({ where: { conversationId_opportunityId: { conversationId: message.conversationId, opportunityId } }, create: { conversationId: message.conversationId, opportunityId }, update: {} });
  const draft = await database.outreachDraft.findUnique({ where: { opportunityId }, select: { id: true } });
  if (!draft) await startOutreachDraftGeneration(opportunityId);
  revalidatePath("/conversations");
  revalidatePath(`/jobs/${opportunityId}`);
}

export async function linkConversationJob(threadId: string, formData: FormData) {
  await requireAuth();
  const opportunityId = formData.get("opportunityId");
  if (typeof opportunityId !== "string" || !opportunityId) throw new Error("Select a job.");
  await getPrisma().conversationJob.upsert({ where: { conversationId_opportunityId: { conversationId: threadId, opportunityId } }, create: { conversationId: threadId, opportunityId }, update: {} });
  revalidatePath("/conversations");
}
