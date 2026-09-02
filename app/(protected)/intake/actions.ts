"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { IntakeStatus, JobSourceType, TaskKind } from "@/app/generated/prisma/enums";
import { requireAuth } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { runIntakePipeline } from "@/services/intake-pipeline";
import { jobFingerprint } from "@/services/job-case";
import { outlookAccessToken } from "@/services/outlook-auth";
import { inboxIntakeText, readOutlookInboxMessage } from "@/services/outlook-graph";
import { startTask } from "@/services/tasks";

// A bound argument still arrives from the client, so the return page is chosen from a fixed set.
const returnPages = new Set(["/intake", "/dashboard"]);

export async function discardIntake(id: string, returnTo = "/intake") {
  await requireAuth();
  const back = returnPages.has(returnTo) ? returnTo : "/intake";
  // Only an intake the user never confirmed can be dropped; a confirmed one owns an opportunity.
  const removed = await getPrisma().jobIntake.deleteMany({ where: { id, status: IntakeStatus.PENDING } });
  if (removed.count !== 1) redirect(`${back}?error=missing`);
  revalidatePath("/intake");
  revalidatePath("/dashboard");
  redirect(`${back}?discarded=1`);
}

/**
 * FR-01's fourth source. The user picks one message; nothing is imported on its own, and the
 * message id is kept so the outreach reply hangs on the mail it answers instead of being guessed.
 */
export async function analyzeInboxMessage(messageId: string) {
  await requireAuth();
  if (!messageId || messageId.length > 20_000) throw new Error("Select one Outlook message.");

  const already = await getPrisma().jobIntake.findUnique({
    where: { sourceMessageId: messageId },
    select: { id: true, opportunityId: true },
  });
  if (already) redirect(already.opportunityId ? `/jobs/${already.opportunityId}` : `/intakes/${already.id}/review`);

  const message = await readOutlookInboxMessage(messageId, { accessToken: await outlookAccessToken() });
  const rawText = inboxIntakeText(message);
  const intake = await getPrisma().jobIntake.create({
    data: {
      // The source type is known here rather than detected: this came out of the mailbox itself.
      sourceType: JobSourceType.DIRECT_EMAIL,
      rawText,
      originalSender: message.fromAddress,
      receivedAt: message.receivedAt,
      fingerprint: jobFingerprint(rawText),
      sourceMessageId: messageId,
    },
    select: { id: true },
  });

  await startTask(
    { kind: TaskKind.INTAKE_PIPELINE, label: "Preparing a job from your mailbox", subjectId: intake.id, href: `/intakes/${intake.id}/review` },
    (task) => runIntakePipeline(intake.id, task),
    after,
  );
  revalidatePath("/intake");
  revalidatePath("/dashboard");
  redirect("/intake");
}
