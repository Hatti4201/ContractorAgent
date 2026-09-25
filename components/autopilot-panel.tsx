import Link from "next/link";
import { cancelScheduledSend, chooseAutopilot, runAutopilotOnWaiting, sendDigestNow } from "@/app/(protected)/dashboard/actions";
import { AutopilotSwitch } from "@/components/autopilot-switch";
import { formatDateTime } from "@/lib/job-values";
import { settingOfMode } from "@/services/autopilot";
import { autopilotOverview } from "@/services/auto-send";
import { waitingForAutopilot } from "@/services/autopilot-batch";
import { digestSettings } from "@/services/digest";
import { lastDigestStatus } from "@/services/digest-send";

const outcomes: Record<string, { label: string; tone: string }> = {
  SENT: { label: "Sent", tone: "bg-emerald-50 text-emerald-800" },
  FAILED: { label: "Not sent", tone: "bg-red-50 text-red-800" },
  CANCELLED: { label: "Cancelled", tone: "bg-slate-100 text-slate-700" },
};

export type AutopilotNotice = { autopilot?: string; cancelled?: string; autopilotRun?: string };

function noticeText(notice: AutopilotNotice) {
  const cancelled = Number(notice.cancelled) || 0;
  const run = notice.autopilotRun === undefined ? null : Number(notice.autopilotRun);
  if (notice.autopilot === "send-refused") return { tone: "warn", text: "Outlook did not grant permission to send, so the autopilot was left as it was." };
  if (notice.autopilot === "send") return { tone: "ok", text: "Automatic sending is on." };
  if (notice.autopilot === "draft" || notice.autopilot === "off") {
    const base = notice.autopilot === "draft" ? "The autopilot now builds drafts; you send them." : "The autopilot is off.";
    return { tone: "ok", text: cancelled ? `${base} ${cancelled} queued email${cancelled === 1 ? " was" : "s were"} not sent and stay in Outlook as drafts.` : base };
  }
  if (run === -1) return { tone: "warn", text: "The autopilot is already working through the waiting jobs." };
  if (run === 0) return { tone: "warn", text: "Nothing was run: no job is waiting with a finished email, or the autopilot is off." };
  if (run) return { tone: "ok", text: `The autopilot is working through ${run} waiting job${run === 1 ? "" : "s"}; progress is in the corner tray.` };
  return null;
}

/** The switch, what the autopilot is about to send, what it sent, and what drafts would have gone out. */
export async function AutopilotPanel({ notice = {} }: { notice?: AutopilotNotice }) {
  const [overview, digest, waiting] = await Promise.all([autopilotOverview(), lastDigestStatus(), waitingForAutopilot()]);
  const { mode, upcoming, recent, shadow } = overview;
  const digestConfig = digestSettings();
  const sending = mode === "send";
  const message = noticeText(notice);

  return (
    <section className="mt-8 scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" id="autopilot">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">Autopilot</h2>
          <p className="mt-1 text-sm text-slate-600">
            {sending
              ? `Sends ${overview.delayMinutes} minutes after the draft is built · ${overview.sentToday} of ${overview.limit} sent in the last 24 hours`
              : mode === "off"
                ? "Jobs are analysed and written, then wait for you."
                : "Drafts are built in Outlook for you to send; the list below shows when each would have gone out."}
          </p>
        </div>
        <AutopilotSwitch choose={chooseAutopilot} current={settingOfMode(mode)} delayMinutes={overview.delayMinutes} limit={overview.limit} />
      </div>

      {message && (
        <p className={`mt-4 rounded-lg border p-3 text-sm font-medium ${message.tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-950"}`} role="status">
          {message.text}
        </p>
      )}

      {mode !== "off" && waiting.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
          <p>
            {waiting.length} job{waiting.length === 1 ? " is" : "s are"} waiting in the queue with a finished email, from before the
            autopilot was on or held by it earlier.
          </p>
          <form action={runAutopilotOnWaiting.bind(null, "/dashboard")}>
            <button className="rounded-lg bg-sky-800 px-3 py-1.5 font-medium text-white hover:bg-sky-900" type="submit">Run the autopilot on them</button>
          </form>
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">About to send ({upcoming.length})</h3>

          {sending && overview.sentToday >= overview.limit && <p className="mt-1 text-xs text-slate-500">The daily limit is reached; these go as the 24-hour window frees up.</p>}
          <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((draft) => (
              <li className="rounded-lg border border-blue-200 px-3 py-2" key={draft.id}>
                <Link className="block truncate text-sm font-semibold text-slate-950 underline" href={`/jobs/${draft.opportunityId}/outreach`}>{draft.opportunity.title}</Link>
                <p className="mt-0.5 truncate text-xs text-slate-600">
                  {draft.opportunity.recruiter?.name ?? "Recruiter unknown"}
                  {draft.autoSendState === "SENDING" ? " · sending now" : draft.autoSendAt ? ` · from ${formatDateTime(draft.autoSendAt)}` : ""}
                </p>
                {draft.autoSendState === "SCHEDULED" && (
                  <form action={cancelScheduledSend.bind(null, draft.id)}>
                    <button className="mt-1 text-xs font-medium text-red-700 underline" type="submit">Don&apos;t send — keep as draft</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {recent.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Last 7 days</h3>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {recent.map((draft) => {
              const outcome = outcomes[draft.autoSendState ?? "CANCELLED"] ?? outcomes.CANCELLED!;
              return (
                <li className="rounded-lg border border-slate-200 px-3 py-2" key={draft.id} title={draft.autoSendError ?? undefined}>
                  <Link className="block truncate text-sm font-semibold text-slate-950 underline" href={`/jobs/${draft.opportunityId}/outreach`}>{draft.opportunity.title}</Link>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-600">
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 font-semibold ${outcome.tone}`}>{outcome.label}</span>
                    <span className="truncate">{draft.autoSentAt ? formatDateTime(draft.autoSentAt) : draft.autoSendError}</span>
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {shadow.items.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Shadow trial, last 7 days</h3>
          <p className="mt-1 text-sm text-slate-700">
            The autopilot would have sent <span className="font-semibold">{shadow.items.length}</span>; you sent{" "}
            <span className="font-semibold">{shadow.sentByYou}</span> of them. Open one to compare what you changed.
          </p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {shadow.items.map((draft) => (
              <li className="rounded-lg border border-slate-200 px-3 py-2" key={draft.id}>
                <Link className="block truncate text-sm font-semibold text-slate-950 underline" href={`/jobs/${draft.opportunityId}/outreach`}>{draft.opportunity.title}</Link>
                <p className="mt-0.5 truncate text-xs text-slate-600">
                  {draft.sentConfirmedAt ? `You sent it ${formatDateTime(draft.sentConfirmedAt)}` : "Not sent by you"}
                  {draft.autoSendAt ? ` · would have gone ${formatDateTime(draft.autoSendAt)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {digestConfig.enabled && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 text-sm">
          <p className="text-slate-600">
            Daily digest by email at {digestConfig.hour}:00
            {digest?.lastDigestAt ? ` · last ${formatDateTime(digest.lastDigestAt)}` : " · none sent yet"}
            {digest?.lastDigestError && <span className="block text-red-700">Last attempt failed: {digest.lastDigestError}</span>}
          </p>
          <form action={sendDigestNow}>
            <button className="rounded-lg border border-slate-400 bg-white px-3 py-1.5 font-medium text-slate-800 hover:border-slate-600" type="submit">Email digest now</button>
          </form>
        </div>
      )}
    </section>
  );
}
