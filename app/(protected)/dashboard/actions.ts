"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { TaskKind } from "@/app/generated/prisma/enums";
import { requireAuth } from "@/lib/auth";
import { outlookAccessToken } from "@/services/outlook-auth";
import { sweepSentDrafts } from "@/services/outreach-pipeline";
import { startTask, TaskBusyError } from "@/services/tasks";

/**
 * The same check the scheduled scan makes, on demand: a draft sent just now should not have to wait
 * for the window to come round again. Deferred because it asks Graph once per waiting draft.
 */
export async function checkSentDraftsNow() {
  await requireAuth();
  try {
    await startTask(
      { kind: TaskKind.OUTLOOK_SENT_CHECK, label: "Checking which drafts have been sent", subjectId: "sent-sweep", href: "/dashboard" },
      async (task) => {
        const archived = await sweepSentDrafts(await outlookAccessToken());
        await task.progress(`${archived} sent`);
      },
      after,
    );
  } catch (error) {
    if (!(error instanceof TaskBusyError)) throw error;
  }
  revalidatePath("/dashboard");
}
