import { ActivityType, AutopilotSetting, AutoSendState, OutlookDraftState, TaskKind } from "@/app/generated/prisma/enums";
import { getPrisma } from "@/lib/prisma";
import { autoSendPlan, modeFromSetting, rankForSending, resolveAutopilotSettings, sendQuota, sendWindowMinutes, staggeredAutoSendAt, type AutopilotMode, type AutopilotSettings } from "@/services/autopilot";
import { outlookAccessToken, outlookSendToken } from "@/services/outlook-auth";
import { approvalIssue, preparedDraft } from "@/services/outlook-draft";
import { configuredTimeZone } from "@/services/attention";
import { OutlookGraphError, outlookDraftStatus, sendOutlookDraft } from "@/services/outlook-graph";
import { sweepSentDrafts } from "@/services/outreach-pipeline";
import { runTaskNow, TaskBusyError, type TaskHandle } from "@/services/tasks";

const CONTROL_ID = "primary";
const DAY_MS = 24 * 60 * 60_000;
// A send claimed this long ago never reported back. It is failed, never retried: Outlook may have
// accepted it, and a second send is the one mistake this feature must not make.
const STALE_SENDING_MS = 15 * 60_000;
const LATE_GRACE_MS = 60 * 60_000;

/**
 * Due, and sendable at this hour. Inside the send window anything due goes. Outside it only what fell
 * due in the last hour does, so the send that lands just after closing time still goes while a laptop
 * waking at 23:00 does not mail a recruiter the morning's backlog; that waits for the next window.
 */
function isWithinSendWindow(now: Date, settings: AutopilotSettings) {
  const window = sendWindowMinutes(settings);
  if (!window) return false;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: configuredTimeZone(), hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map((part) => [part.type, part.value]));
  const current = Number(parts.hour) * 60 + Number(parts.minute);
  return current >= window.start && current < window.end;
}

function dueFilter(now: Date, settings: AutopilotSettings) {
  return isWithinSendWindow(now, settings)
    ? { lte: now }
    : { lte: now, gte: new Date(now.getTime() - LATE_GRACE_MS) };
}

/**
 * Marks a draft the autopilot just built for sending, or for the shadow record of when it would have
 * been sent. Only a draft that is really in Outlook and untouched by any earlier plan qualifies.
 */
export async function scheduleAutoSend(opportunityId: string, mode?: AutopilotMode, now = new Date()) {
  const plan = autoSendPlan(mode ?? await currentAutopilotMode(), now);
  if (!plan) return;
  const database = getPrisma();
  const last = await database.outreachDraft.findFirst({
    where: { autoSendState: AutoSendState.SCHEDULED, autoSendAt: { not: null } },
    orderBy: { autoSendAt: "desc" },
    select: { autoSendAt: true },
  });
  await database.outreachDraft.updateMany({
    where: { opportunityId, outlookState: OutlookDraftState.CREATED, outlookMessageId: { not: null }, autoSendState: null, sentConfirmedAt: null },
    data: { autoSendState: plan.state, autoSendAt: staggeredAutoSendAt(plan.at, last?.autoSendAt ?? null) },
  });
}

/** Where the dashboard switch stands, or the environment's AUTOPILOT until it has been used. */
export async function currentAutopilotMode() {
  const control = await getPrisma().autopilotControl.findUnique({ where: { id: CONTROL_ID }, select: { mode: true } });
  return modeFromSetting(control?.mode);
}

/** The threshold, send window and daily limit as saved on the Autopilot page, or the environment's until then. */
export async function autopilotSettings() {
  const control = await getPrisma().autopilotControl.findUnique({
    where: { id: CONTROL_ID },
    select: { matchThreshold: true, dailySendLimit: true, sendStartTime: true, sendEndTime: true },
  });
  return resolveAutopilotSettings(control);
}

export async function currentMatchThreshold() {
  return (await autopilotSettings()).threshold;
}

/**
 * Saves the page's numbers. Returns the threshold before the save, so the caller can tell whether a
 * lower bar lets jobs the autopilot held back through now.
 */
export async function saveAutopilotSettings(settings: AutopilotSettings) {
  const before = await currentMatchThreshold();
  const data = { matchThreshold: settings.threshold, dailySendLimit: settings.dailyLimit, sendStartTime: settings.startTime, sendEndTime: settings.endTime };
  await getPrisma().autopilotControl.upsert({ where: { id: CONTROL_ID }, create: { id: CONTROL_ID, ...data }, update: data });
  return { previousThreshold: before };
}

/**
 * Moves the switch. Leaving SEND cancels everything still queued to send, so switching away stops
 * sending at once; those emails stay in Outlook as drafts. Returns how many were cancelled.
 */
export async function setAutopilotSetting(setting: AutopilotSetting) {
  const database = getPrisma();
  await database.autopilotControl.upsert({ where: { id: CONTROL_ID }, create: { id: CONTROL_ID, mode: setting }, update: { mode: setting } });
  if (setting === AutopilotSetting.SEND) return 0;
  const { count } = await database.outreachDraft.updateMany({
    where: { autoSendState: AutoSendState.SCHEDULED },
    data: { autoSendState: AutoSendState.CANCELLED, autoSendError: "Automatic sending was switched off; the draft is still in Outlook for you." },
  });
  return count;
}

/** The user keeps the draft and sends it, or not, themselves. */
export async function cancelAutoSend(draftId: string) {
  const { count } = await getPrisma().outreachDraft.updateMany({
    where: { id: draftId, autoSendState: AutoSendState.SCHEDULED },
    data: { autoSendState: AutoSendState.CANCELLED, autoSendError: "You cancelled the automatic send; the draft is still in Outlook." },
  });
  return count === 1;
}

export function sentInLastDay(now = new Date()) {
  return getPrisma().outreachDraft.count({ where: { autoSentAt: { gte: new Date(now.getTime() - DAY_MS) } } });
}

/** Drafts the user can explicitly send from Draft mode after reviewing them in Outlook. */
export function reviewedDraftCount() {
  return getPrisma().outreachDraft.count({
    where: { outlookState: OutlookDraftState.CREATED, outlookMessageId: { not: null }, sentConfirmedAt: null, OR: [{ autoSendState: null }, { autoSendState: AutoSendState.SHADOW }] },
  });
}

async function settle(id: string, state: AutoSendState, error: string | null) {
  await getPrisma().outreachDraft.update({ where: { id }, data: { autoSendState: state, autoSendError: error?.slice(0, 500) ?? null } });
}

async function recoverStaleSends(now: Date) {
  await getPrisma().outreachDraft.updateMany({
    where: { autoSendState: AutoSendState.SENDING, updatedAt: { lt: new Date(now.getTime() - STALE_SENDING_MS) } },
    data: { autoSendState: AutoSendState.FAILED, autoSendError: "The send was interrupted. Check Sent Items in Outlook before sending it yourself." },
  });
}

/**
 * Sends every scheduled draft whose window has passed, best match first, as far as the daily limit
 * allows; what the limit leaves over is handed to the user.
 * Each draft is re-checked right before it goes: still approved, recipient and resume unchanged, still
 * a draft in Outlook. Anything that fails a check is left in Outlook for the user and never retried.
 */
export async function sendDueDrafts(task?: TaskHandle, now = new Date(), onlyId?: string) {
  const database = getPrisma();
  const settings = await autopilotSettings();
  const { dailyLimit: limit } = settings;
  const quota = sendQuota(limit, await sentInLastDay(now));
  const scheduled = await database.outreachDraft.findMany({
    where: { ...(onlyId ? { id: onlyId } : {}), autoSendState: AutoSendState.SCHEDULED, autoSendAt: onlyId ? { lte: now } : dueFilter(now, settings) },
    select: { id: true, opportunityId: true, autoSendAt: true, opportunity: { select: { matchScore: true } } },
  });
  const { sending: ranked, overLimit } = rankForSending(scheduled.map((draft) => ({ ...draft, matchScore: draft.opportunity.matchScore })), quota);
  const due = onlyId ? ranked : ranked.slice(0, 1);
  if (overLimit.length) {
    await database.outreachDraft.updateMany({
      where: { id: { in: overLimit.map((draft) => draft.id) }, autoSendState: AutoSendState.SCHEDULED },
      data: { autoSendState: AutoSendState.CANCELLED, autoSendError: `Not sent: the daily limit of ${limit} was reached and better matches went first. The draft is still in Outlook for you.` },
    });
  }
  if (!due.length) return { sent: 0 };

  let readToken: string;
  let sendToken: string;
  try {
    [readToken, sendToken] = await Promise.all([outlookAccessToken(), outlookSendToken()]);
  } catch (error) {
    // Waiting would only repeat the same refusal every tick; the drafts stay in Outlook for the user.
    const reason = error instanceof Error ? error.message : "Outlook is not connected.";
    await database.outreachDraft.updateMany({
      where: { id: { in: due.map((draft) => draft.id) }, autoSendState: AutoSendState.SCHEDULED },
      data: { autoSendState: AutoSendState.FAILED, autoSendError: reason.slice(0, 500) },
    });
    throw new Error(reason);
  }

  let sent = 0;
  for (const { id, opportunityId } of due) {
    const claimed = await database.outreachDraft.updateMany({ where: { id, autoSendState: AutoSendState.SCHEDULED }, data: { autoSendState: AutoSendState.SENDING } });
    if (claimed.count !== 1) continue;
    await task?.progress(`Sending ${sent + 1} of ${due.length}`);

    let draft: Awaited<ReturnType<typeof preparedDraft>>;
    try { draft = await preparedDraft(opportunityId); } catch {
      // Deleted with its job while this run was under way; nothing is left to send or record.
      await settle(id, AutoSendState.FAILED, "The job could not be read, so nothing was sent.").catch(() => {});
      continue;
    }
    if (draft.outlookState !== OutlookDraftState.CREATED || !draft.outlookMessageId || draft.sentConfirmedAt) {
      await settle(id, AutoSendState.CANCELLED, "The draft changed after it was scheduled, so it was not sent automatically.");
      continue;
    }
    const issue = await approvalIssue(draft);
    if (issue) {
      await settle(id, AutoSendState.FAILED, `Not sent: ${issue}`);
      continue;
    }

    try {
      const status = await outlookDraftStatus(draft.outlookMessageId, { accessToken: readToken });
      if (status === "GONE") { await settle(id, AutoSendState.CANCELLED, "The draft was deleted in Outlook, so nothing was sent."); continue; }
      // The sent-draft sweep archives it like any other send the user made.
      if (status === "SENT") { await settle(id, AutoSendState.CANCELLED, "You sent it from Outlook before the autopilot did."); continue; }
      await sendOutlookDraft(draft.outlookMessageId, { accessToken: sendToken });
    } catch (error) {
      await settle(id, AutoSendState.FAILED, error instanceof OutlookGraphError && error.status === 403
        ? "Outlook refused to send: Mail.Send is not granted. The draft is still in Outlook."
        : "The send did not complete. Check Sent Items in Outlook before sending it yourself.");
      continue;
    }

    await database.$transaction([
      database.outreachDraft.update({ where: { id }, data: { autoSendState: AutoSendState.SENT, autoSentAt: new Date(), autoSendError: null } }),
      database.activity.create({
        data: { opportunityId, type: ActivityType.NOTE, description: "Sent automatically by the autopilot after the match score passed." },
      }),
    ]);
    sent += 1;
  }

  // Records the send, the stage change and the archived copy now instead of at the next hourly scan.
  // Sent Items can lag by a few seconds; whatever is not there yet, the next sweep picks up.
  if (sent) { try { await sweepSentDrafts(readToken); } catch { /* the next sweep retries */ } }
  return { sent };
}

/** One scheduler tick's worth: nothing, and no task row, unless a send is actually due. */
export async function autoSendTick(now = new Date()) {
  await recoverStaleSends(now);
  if (await currentAutopilotMode() !== "send") return;
  const settings = await autopilotSettings();
  if (!await getPrisma().outreachDraft.count({ where: { autoSendState: AutoSendState.SCHEDULED, autoSendAt: dueFilter(now, settings) } })) return;
  try {
    await runTaskNow(
      { kind: TaskKind.AUTO_SEND, label: "Sending the autopilot's emails", subjectId: "auto-send", href: "/autopilot" },
      (task) => sendDueDrafts(task, now).then(() => undefined),
    );
  } catch (error) {
    if (!(error instanceof TaskBusyError)) throw error;
  }
}

const overviewSelection = {
  id: true,
  opportunityId: true,
  autoSendState: true,
  autoSendAt: true,
  autoSentAt: true,
  autoSendError: true,
  sentConfirmedAt: true,
  opportunity: { select: { title: true, recruiter: { select: { name: true } } } },
} as const;

/** Everything the dashboard panel shows: the switch, what is about to go, what went, and the trial. */
export async function autopilotOverview(now = new Date()) {
  const database = getPrisma();
  const week = new Date(now.getTime() - 7 * DAY_MS);
  const [mode, settings, sentToday, upcoming, recent, shadow] = await Promise.all([
    currentAutopilotMode(),
    autopilotSettings(),
    sentInLastDay(now),
    database.outreachDraft.findMany({
      where: { autoSendState: { in: [AutoSendState.SCHEDULED, AutoSendState.SENDING] } },
      select: overviewSelection,
      orderBy: { autoSendAt: "asc" },
    }),
    database.outreachDraft.findMany({
      where: { autoSendState: { in: [AutoSendState.SENT, AutoSendState.FAILED, AutoSendState.CANCELLED] }, updatedAt: { gte: week } },
      select: overviewSelection,
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
    database.outreachDraft.findMany({
      where: { autoSendState: AutoSendState.SHADOW, autoSendAt: { gte: week } },
      select: overviewSelection,
      orderBy: { autoSendAt: "desc" },
    }),
  ]);
  return {
    mode,
    limit: settings.dailyLimit,
    threshold: settings.threshold,
    sentToday,
    upcoming,
    recent,
    // The trial's one number: of the emails the autopilot would have sent, how many you sent yourself.
    shadow: { items: shadow, sentByYou: shadow.filter((draft) => draft.sentConfirmedAt).length },
  };
}
