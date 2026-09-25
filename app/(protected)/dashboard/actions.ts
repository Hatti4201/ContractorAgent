"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { AutopilotSetting, TaskKind } from "@/app/generated/prisma/enums";
import { requireAuth } from "@/lib/auth";
import { cancelAutoSend, setAutopilotSetting } from "@/services/auto-send";
import { startAutopilotOnWaiting } from "@/services/autopilot-batch";
import { sendDigest } from "@/services/digest-send";
import { outlookAccessToken, outlookSendToken } from "@/services/outlook-auth";
import { scanFollowUps } from "@/services/follow-up-scan";
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

/**
 * The same scan the timer runs, on demand: sent drafts, new recruiter mail, and the follow-up it
 * maintains. The tray reports it, because ten model calls can run in sequence here.
 */
export async function scanMailNow() {
  await requireAuth();
  try {
    await startTask(
      { kind: TaskKind.FOLLOW_UP_SCAN, label: "Scanning Outlook for recruiter follow-ups", subjectId: "follow-up-scan", href: "/dashboard" },
      (task) => scanFollowUps(task).then(() => undefined),
      after,
    );
  } catch (error) {
    if (!(error instanceof TaskBusyError)) throw error;
  }
  revalidatePath("/dashboard");
  revalidatePath("/needs-attention");
}

/** Keeps one scheduled email as an Outlook draft for the user to send, or not. */
export async function cancelScheduledSend(draftId: string) {
  await requireAuth();
  await cancelAutoSend(draftId);
  revalidatePath("/dashboard");
}

const settings = new Set<string>(Object.values(AutopilotSetting));

/**
 * The dashboard's autopilot switch. Send is taken only once Outlook allows sending; otherwise the user
 * is sent to Outlook to grant it, and the callback turns sending on when it comes back granted.
 */
export async function chooseAutopilot(setting: string) {
  await requireAuth();
  if (!settings.has(setting)) throw new Error("Choose Off, Drafts or Send.");
  if (setting === AutopilotSetting.SEND) {
    let granted = true;
    try { await outlookSendToken(); } catch { granted = false; }
    if (!granted) redirect("/api/outlook/connect?send=1");
  }
  const cancelled = await setAutopilotSetting(setting as AutopilotSetting);
  revalidatePath("/dashboard");
  revalidatePath("/sweep");
  redirect(`/dashboard?autopilot=${setting.toLowerCase()}${cancelled ? `&cancelled=${cancelled}` : ""}#autopilot`);
}

/** Takes every job still waiting with a finished email through the autopilot as it is now set. */
export async function runAutopilotOnWaiting(returnTo: string) {
  await requireAuth();
  let started = 0;
  try {
    started = await startAutopilotOnWaiting(after);
  } catch (error) {
    if (!(error instanceof TaskBusyError)) throw error;
    started = -1;
  }
  const back = returnTo === "/sweep" ? "/sweep" : "/dashboard";
  revalidatePath(back);
  redirect(`${back}?autopilotRun=${started}${back === "/dashboard" ? "#autopilot" : ""}`);
}

/** The digest on demand, covering everything since the last one; the next scheduled one starts from here. */
export async function sendDigestNow() {
  await requireAuth();
  await sendDigest();
  revalidatePath("/dashboard");
}
