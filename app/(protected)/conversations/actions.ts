"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { startTask, TaskBusyError } from "@/services/tasks";
import { syncOutlookConversations } from "@/services/conversation-sync";
import { TaskKind } from "@/app/generated/prisma/enums";
import { outlookAccessToken } from "@/services/outlook-auth";
import { createIntakeFromMessage } from "@/services/intake-scan";
import { runIntakePipeline } from "@/services/intake-pipeline";
import { startOutreachDraftGeneration } from "@/app/(protected)/jobs/[id]/outreach/actions";

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
