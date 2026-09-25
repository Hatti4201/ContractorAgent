import Link from "next/link";
import { cancelScheduledSend, pauseAutoSend, sendDigestNow } from "@/app/(protected)/dashboard/actions";
import { formatDateTime } from "@/lib/job-values";
import { autopilotOverview } from "@/services/auto-send";
import { digestSettings } from "@/services/digest";
import { lastDigestStatus } from "@/services/digest-send";

const outcomes: Record<string, { label: string; tone: string }> = {
  SENT: { label: "Sent", tone: "bg-emerald-50 text-emerald-800" },
  FAILED: { label: "Not sent", tone: "bg-red-50 text-red-800" },
  CANCELLED: { label: "Cancelled", tone: "bg-slate-100 text-slate-700" },
};

/** What the autopilot is about to send, what it sent, and in shadow mode what it would have sent. */
export async function AutopilotPanel() {
  const [overview, digest] = await Promise.all([autopilotOverview(), lastDigestStatus()]);
  const { mode, paused, upcoming, recent, shadow } = overview;
  const digestConfig = digestSettings();
  if ((mode === "off" || mode === "draft") && !digestConfig.enabled) {
    if (!upcoming.length && !recent.length && !shadow.items.length) return null;
  }
  const sending = mode === "send";

  return (
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" id="autopilot">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">Autopilot</h2>
          <p className="mt-1 text-sm text-slate-600">
            {sending
              ? `Sends ${overview.delayMinutes} minutes after the draft is built · ${overview.sentToday} of ${overview.limit} sent in the last 24 hours`
              : mode === "shadow"
                ? "Shadow trial: drafts are built and you send them; this records when each would have gone out."
                : "Automatic sending is off."}
          </p>
        </div>
        {sending && (
          <form action={pauseAutoSend.bind(null, !paused)}>
            <button className={`rounded-lg px-4 py-2 text-sm font-medium ${paused ? "bg-emerald-700 text-white hover:bg-emerald-800" : "border border-red-300 bg-white text-red-800 hover:border-red-600"}`} type="submit">
              {paused ? "Resume sending" : "Pause all sending"}
            </button>
          </form>
        )}
      </div>

      {sending && paused && (
        <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-950" role="status">
          Sending is paused. Scheduled emails wait as Outlook drafts until you resume.
        </p>
      )}

      {upcoming.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">About to send ({upcoming.length})</h3>
          {!sending && <p className="mt-1 text-xs text-slate-500">AUTOPILOT is not set to send, so these wait.</p>}
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
