import { AutopilotSetting, JobSourceType, OutreachMode } from "@/app/generated/prisma/enums";
import type { IntakePreview } from "@/services/intake-pipeline";
import type { DuplicateMatch, JobCase } from "@/services/job-case";
import type { MatchReport } from "@/services/match-score";
import type { OutreachValidation } from "@/services/outreach-agent";

/**
 * The fit a job needs before the autopilot writes to the recruiter. The first email only has to get
 * the resume read, so the default is half. MATCH_THRESHOLD takes 0.6 or 60; anything unreadable is 0.5.
 */
export function matchThreshold(value = process.env.MATCH_THRESHOLD) {
  const number = Number(value?.trim());
  if (!value?.trim() || !Number.isFinite(number) || number < 0 || number > 100) return 0.5;
  return number > 1 ? number / 100 : number;
}

/**
 * The analyzer's certainty about its own extraction. The review path asks for 70%; the autopilot lets
 * the match score and the validator judge the job instead, and only refuses an extraction this unsure.
 */
export const AUTOPILOT_MIN_CONFIDENCE = 0.5;

/**
 * off (default) = every source waits for the user.
 * draft = mail the scan imported goes all the way to a verified Outlook draft with no click; only what
 *   fails a hard gate waits. The user still sends.
 * shadow = draft, and each draft also records when it would have been sent, so a trial week shows
 *   what automatic sending would have done before it is allowed to.
 * send = the draft is sent immediately after it passes, within the daily limit.
 */
export type AutopilotMode = "off" | "draft" | "shadow" | "send";
const modes: readonly AutopilotMode[] = ["off", "draft", "shadow", "send"];

export function autopilotMode(value = process.env.AUTOPILOT): AutopilotMode {
  const mode = value?.trim().toLowerCase() as AutopilotMode | undefined;
  return mode && modes.includes(mode) ? mode : "off";
}

/**
 * The dashboard switch has three positions: off, drafts (built in Outlook, and the time each would
 * have gone out recorded, which is the shadow trial), and send. Once the user has used it, it decides;
 * until then AUTOPILOT in the environment does, so an existing setup keeps behaving as before.
 */
export function modeFromSetting(setting: AutopilotSetting | null | undefined, env = process.env.AUTOPILOT): AutopilotMode {
  if (setting === AutopilotSetting.SEND) return "send";
  if (setting === AutopilotSetting.DRAFT) return "shadow";
  if (setting === AutopilotSetting.OFF) return "off";
  return autopilotMode(env);
}

/** Where the switch stands for a mode; draft and shadow are one position, since shadow only adds a record. */
export function settingOfMode(mode: AutopilotMode): AutopilotSetting {
  return mode === "send" ? AutopilotSetting.SEND : mode === "off" ? AutopilotSetting.OFF : AutopilotSetting.DRAFT;
}

/**
 * Every intake rides the autopilot once it is on, pasted ones included: a paste is often a forward or
 * a post copied in passing, not a promise to review it. The hard gates apply to it all the same.
 */
export function autopilotApplies(mode = autopilotMode()) {
  return mode !== "off";
}

/** The address as a whole token, so "a@x.com" is not found inside "aa@x.com" or "a@x.com.au". */
export function addressIn(text: string | null, address: string) {
  if (!text) return false;
  const escaped = address.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9._%+@-])${escaped}($|[^a-z0-9._%+@-])`, "i").test(text);
}

export type AutopilotRoute =
  | { mode: typeof OutreachMode.DIRECT_EMAIL_REPLY; thread: "source" | "lookup" }
  | { mode: Exclude<OutreachMode, typeof OutreachMode.DIRECT_EMAIL_REPLY | typeof OutreachMode.THREAD_FOLLOW_UP>; thread: null };

/**
 * How the autopilot answers, decided by who actually sent the job, since the review screen that used
 * to settle it is not there:
 * - the recruiter's own mail, still in Outlook: reply in that thread;
 * - the recruiter's own mail, pasted: reply in their thread if one is found, else a new email;
 * - mail from anyone else (a friend's forward, a Dice relay): a new email to the recruiter address the
 *   text names, which the validator then insists is really in the text and is not the forwarder;
 * - a post or plain text: a new email.
 */
export function autopilotRoute(intake: { sourceType: JobSourceType; sourceMessageId: string | null; originalSender: string | null }, recruiterEmail: string): AutopilotRoute {
  if (intake.sourceType === JobSourceType.FORWARDED_JD) return { mode: OutreachMode.FORWARDED_JD_OUTREACH, thread: null };
  if (intake.sourceType !== JobSourceType.DIRECT_EMAIL) return { mode: OutreachMode.FIRST_OUTREACH, thread: null };
  if (!addressIn(intake.originalSender, recruiterEmail)) return { mode: OutreachMode.FORWARDED_JD_OUTREACH, thread: null };
  return { mode: OutreachMode.DIRECT_EMAIL_REPLY, thread: intake.sourceMessageId ? "source" : "lookup" };
}

function bounded(value: string | undefined, fallback: number, low: number, high: number) {
  const parsed = Number(value?.trim());
  return value?.trim() && Number.isInteger(parsed) && parsed >= low && parsed <= high ? parsed : fallback;
}

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function fallbackSendTime(value: string | undefined, legacyHour: string | undefined, fallback: string) {
  if (value?.trim() && timePattern.test(value.trim())) return value.trim();
  const hour = Number(legacyHour);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? `${String(hour).padStart(2, "0")}:00` : fallback;
}

function timeMinutes(value: string, end = false) {
  if (end && value === "24:00") return 24 * 60;
  if (!timePattern.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

/** The local-time window in which SEND is allowed to call Outlook. */
export type SendWindow = { startTime: string; endTime: string };

export function sendWindowMinutes(window: SendWindow) {
  const start = timeMinutes(window.startTime);
  const end = timeMinutes(window.endTime, true);
  return start !== null && end !== null && start < end ? { start, end } : null;
}

function defaultSendTime(env: Record<string, string | undefined>, specific: string, legacy: string, fallback: string) {
  return fallbackSendTime(env[specific], env[legacy], fallback);
}

/**
 * Sends allowed in any rolling 24 hours, so a restart after a quiet night cannot release a burst. A
 * daily LinkedIn sweep yields more than 20, and far more than this starts to look like bulk mail to
 * Outlook, which can lock the account.
 */
export function autoSendDailyLimit(value = process.env.AUTO_SEND_DAILY_LIMIT) {
  return bounded(value, 50, 0, 500);
}

export type AutopilotSettings = { threshold: number; dailyLimit: number } & SendWindow;
type StoredSettings = { matchThreshold: number | null; dailySendLimit: number | null; sendStartTime: string | null; sendEndTime: string | null };

/**
 * What the Autopilot page saved, each value on its own: one the user has not set yet still comes from
 * the environment, so saving the threshold alone does not silently reset the limit.
 */
export function resolveAutopilotSettings(stored: StoredSettings | null, env: Record<string, string | undefined> = process.env): AutopilotSettings {
  return {
    threshold: stored?.matchThreshold ?? matchThreshold(env.MATCH_THRESHOLD),
    dailyLimit: stored?.dailySendLimit ?? autoSendDailyLimit(env.AUTO_SEND_DAILY_LIMIT),
    startTime: stored?.sendStartTime ?? defaultSendTime(env, "AUTO_SEND_START_TIME", "MAIL_SCAN_START_HOUR", "06:00"),
    endTime: stored?.sendEndTime ?? defaultSendTime(env, "AUTO_SEND_END_TIME", "MAIL_SCAN_END_HOUR", "15:00"),
  };
}

/**
 * The Autopilot page's form: a whole-number threshold/limit and a valid local-time window. Anything
 * out of range is refused with the field's name, never clamped.
 */
export function parseAutopilotSettings(form: { threshold: string; dailyLimit: string; sendStartTime: string; sendEndTime: string }): AutopilotSettings | { error: string } {
  const whole = (value: string, low: number, high: number) => {
    const number = Number(value.trim());
    return value.trim() && Number.isInteger(number) && number >= low && number <= high ? number : null;
  };
  const threshold = whole(form.threshold, 0, 100);
  const dailyLimit = whole(form.dailyLimit, 0, 500);
  if (threshold === null) return { error: "threshold" };
  if (dailyLimit === null) return { error: "limit" };
  const startTime = timeMinutes(form.sendStartTime);
  const endTime = timeMinutes(form.sendEndTime, true);
  if (startTime === null) return { error: "sendStartTime" };
  if (endTime === null) return { error: "sendEndTime" };
  if (startTime >= endTime) return { error: "sendWindow" };
  return { threshold: threshold / 100, dailyLimit, startTime: form.sendStartTime, endTime: form.sendEndTime };
}

/** What happens to a draft the autopilot just built: nothing, a shadow record, or an immediate send. */
export function autoSendPlan(mode: AutopilotMode, now: Date) {
  if (mode !== "shadow" && mode !== "send") return null;
  return {
    state: mode === "send" ? "SCHEDULED" as const : "SHADOW" as const,
    at: new Date(now),
  };
}

export const AUTO_SEND_MIN_DELAY_MS = 5_000;
export const AUTO_SEND_MAX_DELAY_MS = 120_000;

/** Adds a random human-sized gap after the last automatic send already in the queue. */
export function staggeredAutoSendAt(now: Date, lastScheduledAt: Date | null, random = Math.random()) {
  const base = Math.max(now.getTime(), lastScheduledAt?.getTime() ?? 0);
  const delay = AUTO_SEND_MIN_DELAY_MS + Math.floor(Math.max(0, Math.min(1, random)) * (AUTO_SEND_MAX_DELAY_MS - AUTO_SEND_MIN_DELAY_MS));
  return new Date(base + delay);
}

export function sendQuota(limit: number, sentInLastDay: number) {
  return Math.max(0, limit - sentInLastDay);
}

/**
 * When more is due than the limit allows, the best matches go and the rest are left in Outlook for
 * the user at once: by tomorrow, when the quota frees up, a contract post has usually been filled.
 */
export function rankForSending<T extends { matchScore: number | null; autoSendAt: Date | null }>(due: T[], quota: number) {
  const ranked = [...due].sort((left, right) =>
    (right.matchScore ?? -1) - (left.matchScore ?? -1) || (left.autoSendAt?.getTime() ?? 0) - (right.autoSendAt?.getTime() ?? 0));
  return { sending: ranked.slice(0, quota), overLimit: ranked.slice(quota) };
}

/**
 * The first email only has to get the resume in front of the recruiter, so a loose fit is fine. What
 * the email says about the candidate is not: a BLOCK is a wrong recipient, attachment or fabricated
 * fact, and that still waits for the user. A NEEDS_REVIEW left after one rewrite is let through.
 */
export function autopilotAccepts(validation: OutreachValidation | null) {
  return validation?.status === "PASS";
}

/**
 * A second email to someone who already has the first is the one duplicate worth stopping: the same
 * recruiter with the same JD text or a similar title. Another recruiter is another chance to be picked,
 * even at the same vendor with the same post, so it goes ahead; so does another vendor on the same role.
 * An exact copy whose recruiter is unknown on either side is held, since it may be that same person.
 */
export function autopilotDuplicateHold(jobCase: JobCase, matches: DuplicateMatch[]) {
  const recruiter = jobCase.recruiterName?.trim().toLowerCase();
  const same = (match: DuplicateMatch) => Boolean(recruiter && match.recruiter?.trim().toLowerCase() === recruiter);
  const exact = matches.find((match) => match.exact && (same(match) || !recruiter || !match.recruiter));
  if (exact) return `The same JD is already tracked as "${exact.title}".`;
  const sameRecruiter = matches.find((match) => same(match) && match.reasons.includes("Similar job title"));
  return sameRecruiter ? `${jobCase.recruiterName} already has a similar job tracked: "${sameRecruiter.title}".` : null;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** A stated work-authorization mismatch is a hard skip, not a question for the user. */
export function eligibilityConflictReason(report: MatchReport | null) {
  const conflict = report?.requirements.find((item) => item.kind === "eligibility" && item.verdict === "CONFLICT");
  return conflict ? `Eligibility conflict: ${conflict.requirement}${conflict.evidence ? ` (your context: "${conflict.evidence}")` : ""}.` : null;
}

/**
 * An eligibility conflict the context itself states is the one thing no loose fit makes up for; below
 * that, the score decides. A JD with no skills to score goes ahead, since there is nothing to fall short of.
 */
export function autopilotMatchHold(report: MatchReport | null, threshold = matchThreshold()) {
  if (!report) return "The match score could not be computed.";
  const eligibilityConflict = eligibilityConflictReason(report);
  if (eligibilityConflict) return eligibilityConflict;
  if (report.score === null || report.score >= threshold) return null;
  const missing = report.requirements.filter((item) => item.kind === "skill" && item.verdict === "MISSING").map((item) => item.requirement);
  return `Match ${percent(report.score)} is below ${percent(threshold)}${missing.length ? `; missing ${missing.slice(0, 5).join(", ")}` : ""}.`;
}

/**
 * A job the pipeline finished with a complete email, which is all the autopilot needs to take it on
 * later. A brake means the pipeline itself stopped (no email, no resume), and no rerun changes that.
 */
export function readyForAutopilot(preview: Pick<IntakePreview, "body" | "toAddress" | "brake"> | null) {
  return Boolean(preview?.body && preview.toAddress && !preview.brake);
}
