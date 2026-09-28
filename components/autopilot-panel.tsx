import Link from "next/link";
import { Bot, CircleCheck, CircleSlash, CircleX, Clock, FilePen, Ghost, History, Hourglass, Mail, Pause, Play, Send } from "lucide-react";
import { cancelScheduledSend, chooseAutopilot, runAutopilotOnWaiting, sendDigestNow } from "@/app/(protected)/autopilot/actions";
import { AutopilotSwitch } from "@/components/autopilot-switch";
import { Toast } from "@/components/toast";
import { formatDateTime } from "@/lib/job-values";
import { settingOfMode } from "@/services/autopilot";
import { autopilotOverview } from "@/services/auto-send";
import { waitingForAutopilot } from "@/services/autopilot-batch";
import { digestSettings } from "@/services/digest";
import { lastDigestStatus } from "@/services/digest-send";

export type AutopilotNotice = { autopilot?: string; cancelled?: string; autopilotRun?: string; saved?: string; invalid?: string };

const noticeKeys = ["autopilot", "cancelled", "autopilotRun", "saved", "invalid"];
const invalidFields: Record<string, string> = { threshold: "Match: 0–100", delay: "Delay: 1–1440 min", limit: "Daily limit: 0–500" };

/** One line for whatever the last action did; a batch it started rides along as "▶ N". */
function noticeText(notice: AutopilotNotice): { text: string; tone: "ok" | "warn" } | null {
  const cancelled = Number(notice.cancelled) || 0;
  const run = notice.autopilotRun === undefined ? null : Number(notice.autopilotRun);
  const ran = run && run > 0 ? ` · ▶ ${run}` : run === -1 ? " · already running" : "";
  const kept = cancelled ? ` · ${cancelled} queued kept as drafts` : "";
  if (notice.invalid) return { tone: "warn", text: invalidFields[notice.invalid] ?? "Check the numbers" };
  if (notice.autopilot === "send-refused") return { tone: "warn", text: "Outlook did not allow sending" };
  if (notice.autopilot === "send") return { tone: "ok", text: `Sending on${ran}` };
  if (notice.autopilot === "draft") return { tone: "ok", text: `Drafts only${kept}${ran}` };
  if (notice.autopilot === "off") return { tone: "ok", text: `Autopilot off${kept}` };
  if (notice.saved) return { tone: "ok", text: `Saved${ran}` };
  if (run === -1) return { tone: "warn", text: "Already running" };
  if (run === 0) return { tone: "warn", text: "Nothing to run" };
  if (run) return { tone: "ok", text: `Running on ${run}` };
  return null;
}

const outcomeIcons = {
  SENT: { icon: CircleCheck, tone: "text-emerald-600", tip: "Sent" },
  FAILED: { icon: CircleX, tone: "text-red-600", tip: "Not sent" },
  CANCELLED: { icon: CircleSlash, tone: "text-slate-400", tip: "Cancelled" },
} as const;

const summaryClass = "flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100 [&::-webkit-details-marker]:hidden";

/** The switch and the autopilot's numbers in one row; each list opens from its icon. */
export async function AutopilotPanel({ notice = {} }: { notice?: AutopilotNotice }) {
  const [overview, digest, waiting] = await Promise.all([autopilotOverview(), lastDigestStatus(), waitingForAutopilot()]);
  const { mode, upcoming, recent, shadow } = overview;
  const digestConfig = digestSettings();
  const message = noticeText(notice);
  const count = (state: keyof typeof outcomeIcons) => recent.filter((draft) => draft.autoSendState === state).length;

  return (
    <section aria-label="Autopilot" className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      {message && <Toast clear={noticeKeys} text={message.text} tone={message.tone} />}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Bot aria-label="Autopilot" className="text-slate-500" size={22} />
        <AutopilotSwitch choose={chooseAutopilot} current={settingOfMode(mode)} delayMinutes={overview.delayMinutes} limit={overview.limit} />

        {mode === "send" && (
          <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-700" title={`Sent in the last 24 hours, of ${overview.limit} allowed`}>
            <Send aria-hidden="true" className="text-emerald-600" size={15} /> {overview.sentToday}/{overview.limit}
          </span>
        )}

        {mode !== "off" && waiting.length > 0 && (
          <form action={runAutopilotOnWaiting.bind(null, "/autopilot")}>
            <button
              aria-label={`Run the autopilot on ${waiting.length} jobs waiting with a finished email`}
              className="flex items-center gap-1.5 rounded-lg bg-sky-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-800"
              title={`Run the autopilot on ${waiting.length} jobs waiting with a finished email`}
              type="submit"
            >
              <Play aria-hidden="true" size={14} /> {waiting.length}
            </button>
          </form>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-1">
          {upcoming.length > 0 && (
            <details className="group relative">
              <summary className={summaryClass} title="About to send">
                <Clock aria-hidden="true" className="text-sky-600" size={15} /> {upcoming.length}
              </summary>
              <ul className="absolute right-0 z-20 mt-1 w-80 space-y-1 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                {upcoming.map((draft) => (
                  <li className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 hover:bg-slate-50" key={draft.id}>
                    <Link className="truncate text-sm font-medium text-slate-900" href={`/jobs/${draft.opportunityId}/outreach`} title={`${draft.opportunity.recruiter?.name ?? ""}${draft.autoSendAt ? ` · ${formatDateTime(draft.autoSendAt)}` : ""}`}>
                      {draft.opportunity.title}
                    </Link>
                    {draft.autoSendState === "SCHEDULED" && (
                      <form action={cancelScheduledSend.bind(null, draft.id)}>
                        <button aria-label={`Don't send ${draft.opportunity.title}; keep it as a draft`} className="rounded p-1 text-red-600 hover:bg-red-50" title="Don't send, keep as draft" type="submit">
                          <CircleSlash aria-hidden="true" size={15} />
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {recent.length > 0 && (
            <details className="relative">
              <summary className={summaryClass} title="Last 7 days">
                <History aria-hidden="true" size={15} />
                {(Object.keys(outcomeIcons) as Array<keyof typeof outcomeIcons>).map((state) => {
                  const { icon: Icon, tone } = outcomeIcons[state];
                  return count(state) ? <span className="flex items-center gap-0.5" key={state}><Icon aria-hidden="true" className={tone} size={13} />{count(state)}</span> : null;
                })}
              </summary>
              <ul className="absolute right-0 z-20 mt-1 w-80 space-y-1 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                {recent.map((draft) => {
                  const { icon: Icon, tone, tip } = outcomeIcons[(draft.autoSendState ?? "CANCELLED") as keyof typeof outcomeIcons] ?? outcomeIcons.CANCELLED;
                  return (
                    <li className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-50" key={draft.id} title={draft.autoSendError ?? (draft.autoSentAt ? formatDateTime(draft.autoSentAt) : tip)}>
                      <Icon aria-label={tip} className={`shrink-0 ${tone}`} size={14} />
                      <Link className="truncate text-sm text-slate-900" href={`/jobs/${draft.opportunityId}/outreach`}>{draft.opportunity.title}</Link>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}

          {shadow.items.length > 0 && (
            <details className="relative">
              <summary className={summaryClass} title="Drafts only, last 7 days: would have sent / you sent">
                <Ghost aria-hidden="true" size={15} /> {shadow.items.length}
                <span className="text-slate-400">/</span>
                <Send aria-hidden="true" size={13} /> {shadow.sentByYou}
              </summary>
              <ul className="absolute right-0 z-20 mt-1 w-80 space-y-1 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                {shadow.items.map((draft) => (
                  <li className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-50" key={draft.id} title={draft.autoSendAt ? `Would have gone ${formatDateTime(draft.autoSendAt)}` : undefined}>
                    {draft.sentConfirmedAt
                      ? <CircleCheck aria-label="You sent it" className="shrink-0 text-emerald-600" size={14} />
                      : <Clock aria-label="Not sent by you" className="shrink-0 text-slate-400" size={14} />}
                    <Link className="truncate text-sm text-slate-900" href={`/jobs/${draft.opportunityId}/outreach`}>{draft.opportunity.title}</Link>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {digestConfig.enabled && (
            <form action={sendDigestNow}>
              <button
                aria-label="Email the digest now"
                className={`relative rounded-lg p-1.5 hover:bg-slate-100 ${digest?.lastDigestError ? "text-red-600" : "text-slate-500"}`}
                title={digest?.lastDigestError ? `Last digest failed: ${digest.lastDigestError}` : `Digest daily at ${digestConfig.hour}:00${digest?.lastDigestAt ? ` · last ${formatDateTime(digest.lastDigestAt)}` : ""} · click to send now`}
                type="submit"
              >
                <Mail aria-hidden="true" size={17} />
                {digest?.lastDigestError && <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-red-600" />}
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

const chipModes = {
  off: { icon: Pause, label: "Off", tone: "border-amber-300 bg-amber-50 text-amber-900" },
  draft: { icon: FilePen, label: "Drafts", tone: "border-sky-200 bg-sky-50 text-sky-900" },
  shadow: { icon: FilePen, label: "Drafts", tone: "border-sky-200 bg-sky-50 text-sky-900" },
  send: { icon: Send, label: "Send", tone: "border-emerald-200 bg-emerald-50 text-emerald-900" },
} as const;

/** The dashboard's view of the autopilot: where the switch stands and what is moving; the controls are on its page. */
export async function AutopilotChip() {
  const [overview, waiting] = await Promise.all([autopilotOverview(), waitingForAutopilot()]);
  const { icon: Icon, label, tone } = chipModes[overview.mode];
  return (
    <Link
      aria-label={`Autopilot: ${label}. Open the autopilot page`}
      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm font-semibold hover:shadow-sm ${tone}`}
      href="/autopilot"
      title="Autopilot"
    >
      <Bot aria-hidden="true" size={18} />
      <span className="flex items-center gap-1"><Icon aria-hidden="true" size={15} />{label}</span>
      <span className="flex items-center gap-1 font-medium opacity-80" title="Match threshold"><span aria-hidden="true">≥</span>{Math.round(overview.threshold * 100)}%</span>
      {overview.mode === "send" && (
        <span className="flex items-center gap-1 font-medium opacity-80" title={`Sent in the last 24 hours, of ${overview.limit}`}>
          <Send aria-hidden="true" size={13} />{overview.sentToday}/{overview.limit}
        </span>
      )}
      {overview.upcoming.length > 0 && (
        <span className="flex items-center gap-1 font-medium opacity-80" title="About to send"><Clock aria-hidden="true" size={13} />{overview.upcoming.length}</span>
      )}
      {waiting.length > 0 && (
        <span className="flex items-center gap-1 font-medium opacity-80" title="Waiting with a finished email"><Hourglass aria-hidden="true" size={13} />{waiting.length}</span>
      )}
    </Link>
  );
}
