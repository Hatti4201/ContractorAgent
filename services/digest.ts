import { calendarDate } from "@/services/attention";
import { localClock, type ScanWindow } from "@/services/mail-schedule";

/**
 * Marks the digest the app mails to its own user. The scan reads that same Inbox, and a message full
 * of job titles from the user's own address must never be judged as a recruiter's mail.
 */
export const DIGEST_SUBJECT_PREFIX = "[Contractor Agent]";

export function isDigestMessage(message: { subject: string }) {
  return message.subject.trimStart().startsWith(DIGEST_SUBJECT_PREFIX);
}

/** Where the links point: APP_URL when set, otherwise the origin Outlook already calls back to. */
export function appUrl(env: Partial<Record<string, string>> = process.env) {
  for (const value of [env.APP_URL, env.MICROSOFT_REDIRECT_URI]) {
    try { if (value) return new URL(value).origin; } catch { /* try the next one */ }
  }
  return "http://localhost:3008";
}

export type DigestSettings = { enabled: boolean; hour: number; to: string | null };

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Off unless asked for. It goes out once a scan day, at DIGEST_HOUR, by default when the scan window closes. */
export function digestSettings(env: Partial<Record<string, string>> = process.env): DigestSettings {
  const hour = Number(env.DIGEST_HOUR ?? env.MAIL_SCAN_END_HOUR ?? "15");
  const to = env.DIGEST_TO?.trim() ?? "";
  return {
    enabled: env.DAILY_DIGEST?.trim().toLowerCase() === "on",
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 15,
    to: emailPattern.test(to) && to.length <= 320 ? to : null,
  };
}

/**
 * Due on a scan day once the local hour reaches the digest hour, and only once per local date. A
 * server started after the hour still sends that day's digest; one started the next day does not
 * send yesterday's as well.
 */
export function digestDue(now: Date, lastDigestOn: string | null, settings: DigestSettings, window: ScanWindow) {
  if (!settings.enabled) return false;
  const { day, hour } = localClock(now, window.timeZone);
  return window.days.includes(day) && hour >= settings.hour && lastDigestOn !== calendarDate(now, window.timeZone);
}

type Job = { opportunityId: string; title: string; recruiter: string | null };

export type DigestData = {
  since: Date;
  sent: Array<Job & { at: Date }>;
  notSent: Array<Job & { reason: string | null }>;
  waitingInOutlook: Job[];
  needsInput: Array<{ intakeId: string; title: string; reason: string | null }>;
  followUps: number;
  scanFailures: number;
  scanError: string | null;
};

function escape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Nothing to report is not worth an email; a failing scan always is. */
export function digestEmpty(data: DigestData) {
  return !data.sent.length && !data.notSent.length && !data.waitingInOutlook.length && !data.needsInput.length && !data.followUps && !data.scanFailures;
}

/**
 * The day in one email: what went out on its own, what did not and why, and what is waiting on the
 * user. Every title and reason came from someone's mail, so all of it is escaped before it is HTML.
 */
export function buildDigest(data: DigestData, appUrl: string, formatTime: (value: Date) => string) {
  const link = (path: string, text: string) => `<a href="${escape(`${appUrl}${path}`)}">${escape(text)}</a>`;
  const who = (job: Job) => (job.recruiter ? ` — ${escape(job.recruiter)}` : "");
  const section = (heading: string, items: string[]) => items.length
    ? `<h3 style="margin:18px 0 6px">${escape(heading)} (${items.length})</h3><ul style="margin:0;padding-left:20px">${items.map((item) => `<li style="margin:3px 0">${item}</li>`).join("")}</ul>`
    : "";

  const needs = data.needsInput.length + data.notSent.length;
  const subject = `${DIGEST_SUBJECT_PREFIX} ${data.sent.length} sent automatically, ${needs} need${needs === 1 ? "s" : ""} you`;
  const html = [
    `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#0f172a">`,
    `<p>Since ${escape(formatTime(data.since))}.</p>`,
    data.scanFailures
      ? `<p style="padding:8px;border:1px solid #fca5a5;background:#fef2f2"><strong>The Outlook scan has failed ${data.scanFailures} time(s) in a row.</strong> ${escape(data.scanError ?? "")} ${link("/needs-attention", "Open Needs attention")}</p>`
      : "",
    section("Sent automatically", data.sent.map((job) => `${link(`/jobs/${job.opportunityId}/outreach`, job.title)}${who(job)} · ${escape(formatTime(job.at))}`)),
    section("Not sent — left in Outlook for you", data.notSent.map((job) => `${link(`/jobs/${job.opportunityId}/outreach`, job.title)}${who(job)}${job.reason ? `<br><span style="color:#64748b">${escape(job.reason)}</span>` : ""}`)),
    section("Needs your input", data.needsInput.map((item) => `${link(`/intakes/${item.intakeId}/review`, item.title)}${item.reason ? `<br><span style="color:#64748b">${escape(item.reason)}</span>` : ""}`)),
    section("Drafts waiting in Outlook for you to send", data.waitingInOutlook.map((job) => `${link(`/jobs/${job.opportunityId}/outreach`, job.title)}${who(job)}`)),
    data.followUps ? `<p style="margin-top:18px">${data.followUps} recruiter repl${data.followUps === 1 ? "y" : "ies"} to review: ${link("/needs-attention", "Needs attention")}</p>` : "",
    `<p style="margin-top:18px;color:#64748b">${link("/dashboard", "Open the dashboard")}</p>`,
    `</div>`,
  ].join("");
  return { subject, html };
}
