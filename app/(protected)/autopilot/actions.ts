"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { AutopilotSetting, AutoSendState, OutlookDraftState, TaskKind } from "@/app/generated/prisma/enums";
import { requireAuth } from "@/lib/auth";
import { parseAutopilotSettings } from "@/services/autopilot";
import { cancelAutoSend, currentAutopilotMode, saveAutopilotSettings, sendDueDrafts, setAutopilotSetting } from "@/services/auto-send";
import { rerunWaiting, startAutopilotOnWaiting } from "@/services/autopilot-batch";
import { sendDigest } from "@/services/digest-send";
import { outlookSendToken } from "@/services/outlook-auth";
import { runTaskNow, TaskBusyError } from "@/services/tasks";
import { getPrisma } from "@/lib/prisma";
import { saveEmployerCcAddress } from "@/services/employer";

function refresh() {
  revalidatePath("/autopilot");
  revalidatePath("/dashboard");
  revalidatePath("/sweep");
}

const settings = new Set<string>(Object.values(AutopilotSetting));

/**
 * The autopilot switch. Send is taken only once Outlook allows sending; otherwise the user is sent to
 * Outlook to grant it, and the callback turns sending on when it comes back granted. Turning it on also
 * takes the jobs already waiting through it, so nothing needs a second click.
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
  const run = setting === AutopilotSetting.OFF ? null : await rerunWaiting(after);
  refresh();
  redirect(`/autopilot?autopilot=${setting.toLowerCase()}${cancelled ? `&cancelled=${cancelled}` : ""}${run ? `&autopilotRun=${run}` : ""}`);
}

/**
 * The private employer address, threshold, send window and daily limit. With the autopilot on, the waiting jobs are taken through
 * again at once: a lower bar lets through what the old one held back.
 */
export async function saveAutopilotSettingsAction(formData: FormData) {
  await requireAuth();
  const field = (name: string) => String(formData.get(name) ?? "");
  const employer = await saveEmployerCcAddress(field("employerCcAddress"));
  if (employer.issue) redirect("/autopilot?invalid=employer");
  const parsed = parseAutopilotSettings({ threshold: field("threshold"), dailyLimit: field("dailyLimit"), sendStartTime: field("sendStartTime"), sendEndTime: field("sendEndTime") });
  if ("error" in parsed) redirect(`/autopilot?invalid=${parsed.error}`);
  await saveAutopilotSettings(parsed);
  const run = (await currentAutopilotMode()) === "off" ? null : await rerunWaiting(after);
  refresh();
  redirect(`/autopilot?saved=1${run ? `&autopilotRun=${run}` : ""}`);
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
  const back = returnTo === "/sweep" ? "/sweep" : "/autopilot";
  refresh();
  redirect(`${back}?autopilotRun=${started}`);
}

/** Sends the Outlook drafts the user reviewed while the autopilot was in Draft mode. */
export async function sendReviewedDraftsNow() {
  await requireAuth();
  if (await currentAutopilotMode() !== "shadow") redirect("/autopilot?draftSend=wrong-mode");
  const database = getPrisma();
  const { count } = await database.outreachDraft.updateMany({
    where: { outlookState: OutlookDraftState.CREATED, outlookMessageId: { not: null }, sentConfirmedAt: null, OR: [{ autoSendState: null }, { autoSendState: AutoSendState.SHADOW }] },
    data: { autoSendState: AutoSendState.SCHEDULED, autoSendAt: new Date(), autoSendError: null },
  });
  let started = 0;
  if (count) {
    try {
      await runTaskNow({ kind: TaskKind.AUTO_SEND, label: "Sending reviewed Outlook drafts", subjectId: "draft-send", href: "/autopilot" }, (task) => sendDueDrafts(task).then(() => undefined));
      started = count;
    } catch (error) {
      if (!(error instanceof TaskBusyError)) throw error;
      started = -1;
    }
  }
  refresh();
  redirect(`/autopilot?draftSend=${started}`);
}

/** Keeps one scheduled email as an Outlook draft for the user to send, or not. */
export async function cancelScheduledSend(draftId: string) {
  await requireAuth();
  await cancelAutoSend(draftId);
  refresh();
}

/** Sends one scheduled draft immediately without releasing the rest of the queue. */
export async function sendScheduledDraftNow(draftId: string) {
  await requireAuth();
  const database = getPrisma();
  const { count } = await database.outreachDraft.updateMany({
    where: { id: draftId, autoSendState: AutoSendState.SCHEDULED },
    data: { autoSendAt: new Date(), autoSendError: null },
  });
  if (count) {
    try {
      await runTaskNow({ kind: TaskKind.AUTO_SEND, label: "Sending one priority email", subjectId: `priority-send-${draftId}`, href: "/autopilot" }, (task) => sendDueDrafts(task, new Date(), draftId).then(() => undefined));
    } catch (error) {
      if (!(error instanceof TaskBusyError)) throw error;
    }
  }
  refresh();
}

/** The digest on demand, covering everything since the last one; the next scheduled one starts from here. */
export async function sendDigestNow() {
  await requireAuth();
  await sendDigest();
  refresh();
}
