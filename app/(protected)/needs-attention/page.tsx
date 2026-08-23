import Link from "next/link";
import {
  confirmFollowUpSuggestion,
  dismissFollowUpSuggestion,
  linkFollowUpSuggestion,
  retryFollowUpSuggestion,
  syncOutlookFollowUps,
} from "@/app/(protected)/needs-attention/actions";
import { ApplicationStage, FollowUpStatus } from "@/app/generated/prisma/enums";
import { requireAuth } from "@/lib/auth";
import { formatDate, formatDateTime, formatEnum } from "@/lib/job-values";
import { getPrisma } from "@/lib/prisma";
import { buildAttentionItems, configuredTimeZone, type AttentionItem } from "@/services/attention";
import { parseFollowUpEvidence } from "@/services/follow-up";
import { outlookConnected } from "@/services/outlook-auth";

function dueLabel(item: AttentionItem) {
  if (!item.daysOverdue) return "Due today";
  return `${item.daysOverdue} day${item.daysOverdue === 1 ? "" : "s"} overdue`;
}

const terminalStages = new Set<ApplicationStage>([
  ApplicationStage.HIRED,
  ApplicationStage.NO_RESPONSE,
  ApplicationStage.REJECTED,
  ApplicationStage.ROLE_CLOSED,
  ApplicationStage.WITHDRAWN,
  ApplicationStage.DUPLICATE,
]);

function proposedText(value: string | null, hasBusinessChange: boolean) {
  return hasBusinessChange ? value ?? "Clear field" : "No change";
}

export default async function NeedsAttentionPage({ searchParams }: { searchParams: Promise<{ mail?: string }> }) {
  await requireAuth();
  const database = getPrisma();
  const [{ mail }, opportunities, suggestions, connected] = await Promise.all([
    searchParams,
    database.opportunity.findMany({
      select: {
        id: true,
        title: true,
        client: true,
        recruiter: { select: { name: true } },
        vendor: { select: { name: true } },
        applicationTrack: {
          select: {
            currentStage: true,
            waitingOn: true,
            nextAction: true,
            nextFollowUpAt: true,
            attentionClearedAt: true,
          },
        },
        activities: { select: { type: true, occurredAt: true } },
      },
    }),
    database.followUpSuggestion.findMany({
      where: { status: { in: [FollowUpStatus.PENDING, FollowUpStatus.FAILED] } },
      include: { opportunity: { include: { applicationTrack: true } } },
      orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
      take: 50,
    }),
    outlookConnected(),
  ]);
  const timeZone = configuredTimeZone();
  const items = buildAttentionItems(opportunities, new Date(), timeZone);
  const linkable = opportunities.filter((opportunity) => opportunity.applicationTrack && !terminalStages.has(opportunity.applicationTrack.currentStage));

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Phase 8 · Human review</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Needs attention</h1>
          <p className="mt-2 text-slate-600">{suggestions.length} email suggestion{suggestions.length === 1 ? "" : "s"} · {items.length} follow-up{items.length === 1 ? "" : "s"} due · {timeZone}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {connected ? (
            <form action={syncOutlookFollowUps}>
              <button className="rounded-lg bg-blue-700 px-4 py-2.5 font-medium text-white hover:bg-blue-800" type="submit">Scan recent Outlook mail</button>
            </form>
          ) : (
            <Link className="rounded-lg bg-blue-700 px-4 py-2.5 font-medium text-white hover:bg-blue-800" href="/outlook">Connect Outlook</Link>
          )}
          <Link className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 font-medium text-slate-700 hover:border-slate-500" href="/jobs">All jobs</Link>
        </div>
      </div>

      {mail === "started" && <p className="mt-6 rounded-xl bg-emerald-50 p-4 text-sm font-medium text-emerald-900">Scanning Outlook in the background. Watch the corner tray; suggestions appear here as they are analyzed, and you can leave this page.</p>}

      <section className="mt-8" aria-labelledby="email-suggestions">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold text-slate-950" id="email-suggestions">Recruiter email suggestions</h2>
            <p className="mt-1 text-sm text-slate-600">AI suggestions do not update any business field until you confirm.</p>
          </div>
          <p className="text-xs text-slate-500">Only recent known-recruiter or strong job-subject matches are analyzed.</p>
        </div>

        {suggestions.length ? (
          <ol className="mt-5 grid gap-5">
            {suggestions.map((suggestion) => {
              const evidence = parseFollowUpEvidence(suggestion.evidence);
              const lowConfidence = suggestion.confidence !== null && suggestion.confidence < 0.7;
              const hasBusinessChange = Boolean(suggestion.proposedActivity);
              return (
                <li className={`rounded-2xl border bg-white p-6 shadow-sm ${suggestion.status === FollowUpStatus.FAILED ? "border-red-200" : lowConfidence || !suggestion.opportunity ? "border-amber-300" : "border-slate-200"}`} key={suggestion.id}>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-slate-500">{suggestion.fromAddress} · {formatDateTime(suggestion.receivedAt)} UTC</p>
                      <h3 className="mt-1 text-lg font-semibold text-slate-950">{suggestion.subject}</h3>
                      <p className="mt-2 text-sm text-slate-700">{suggestion.opportunity ? <>Matched to <Link className="font-medium text-emerald-700 underline" href={`/jobs/${suggestion.opportunity.id}`}>{suggestion.opportunity.title}</Link></> : "No opportunity confidently matched."}</p>
                    </div>
                    <div className="text-right">
                      <p className={`rounded-full px-3 py-1 text-sm font-semibold ${suggestion.status === FollowUpStatus.FAILED ? "bg-red-100 text-red-900" : lowConfidence ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}>{suggestion.status === FollowUpStatus.FAILED ? "Analysis failed" : `${Math.round((suggestion.confidence ?? 0) * 100)}% confidence`}</p>
                      {suggestion.event && <p className="mt-2 text-xs font-medium text-slate-600">{formatEnum(suggestion.event)}</p>}
                    </div>
                  </div>

                  {suggestion.status === FollowUpStatus.FAILED ? (
                    <div className="mt-5">
                      <p className="rounded-xl bg-red-50 p-4 text-sm text-red-900">{suggestion.error} · Retry count: {suggestion.retryCount}</p>
                      <div className="mt-4 flex gap-3">
                        <form action={retryFollowUpSuggestion.bind(null, suggestion.id)}><button className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-medium text-white" type="submit">Retry analysis</button></form>
                        <form action={dismissFollowUpSuggestion.bind(null, suggestion.id)}><button className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700" type="submit">Dismiss</button></form>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="mt-5 grid gap-4 lg:grid-cols-2">
                        <div className="rounded-xl bg-slate-50 p-4">
                          <h4 className="text-sm font-semibold text-slate-950">Evidence</h4>
                          {evidence.length ? <ul className="mt-3 space-y-2 text-sm text-slate-700">{evidence.map(({ quote }, index) => <li key={`${suggestion.id}-${index}`}>“{quote}”</li>)}</ul> : <p className="mt-2 text-sm text-amber-800">Evidence unavailable; dismiss or retry after review.</p>}
                        </div>
                        <div className="rounded-xl bg-slate-50 p-4">
                          <h4 className="text-sm font-semibold text-slate-950">Proposed changes</h4>
                          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                            <div><dt className="text-slate-500">Activity</dt><dd className="font-medium text-slate-900">{suggestion.proposedActivity ? formatEnum(suggestion.proposedActivity) : "None"}</dd></div>
                            <div><dt className="text-slate-500">Stage</dt><dd className="font-medium text-slate-900">{suggestion.proposedStage ? formatEnum(suggestion.proposedStage) : "No stage change"}</dd></div>
                            <div><dt className="text-slate-500">Waiting on</dt><dd className="font-medium text-slate-900">{proposedText(suggestion.proposedWaitingOn, hasBusinessChange)}</dd></div>
                            <div><dt className="text-slate-500">Next action</dt><dd className="font-medium text-slate-900">{proposedText(suggestion.proposedNextAction, hasBusinessChange)}</dd></div>
                            <div><dt className="text-slate-500">Follow-up date</dt><dd className="font-medium text-slate-900">{suggestion.proposedNextFollowUpAt ? formatDate(suggestion.proposedNextFollowUpAt) : hasBusinessChange ? "Clear field" : "No change"}</dd></div>
                          </dl>
                        </div>
                      </div>

                      {!suggestion.opportunity && (
                        <form action={linkFollowUpSuggestion.bind(null, suggestion.id)} className="mt-5 flex flex-wrap items-end gap-3">
                          <label className="min-w-64 flex-1 text-sm font-medium text-slate-800">Link to an active opportunity
                            <select className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5" name="opportunityId" required defaultValue="">
                              <option disabled value="">Select opportunity</option>
                              {linkable.map((opportunity) => <option key={opportunity.id} value={opportunity.id}>{opportunity.title}{opportunity.client ? ` · ${opportunity.client}` : ""}</option>)}
                            </select>
                          </label>
                          <button className="rounded-lg border border-slate-400 px-4 py-2.5 text-sm font-medium text-slate-800" type="submit">Link for review</button>
                        </form>
                      )}

                      <div className="mt-5 flex flex-wrap gap-3">
                        {suggestion.opportunity && suggestion.proposedActivity && evidence.length > 0 && <form action={confirmFollowUpSuggestion.bind(null, suggestion.id)}><button className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-800" type="submit">Confirm proposed changes</button></form>}
                        <form action={dismissFollowUpSuggestion.bind(null, suggestion.id)}><button className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700" type="submit">Dismiss</button></form>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ol>
        ) : <p className="mt-5 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">No pending recruiter email suggestions. Scan Outlook when you want to check recent mail.</p>}
      </section>

      <section className="mt-10" aria-labelledby="scheduled-follow-ups">
        <h2 className="text-2xl font-semibold text-slate-950" id="scheduled-follow-ups">Scheduled follow-ups</h2>
        {items.length ? (
          <ol className="mt-5 grid gap-5 lg:grid-cols-2">
            {items.map((item) => (
              <li className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" key={item.jobId}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><p className="text-sm font-semibold text-emerald-800">{formatEnum(item.stage)}</p><h3 className="mt-1 text-xl font-semibold text-slate-950">{item.title}</h3><p className="mt-1 text-sm text-slate-600">{item.client ?? "Client not set"}</p></div>
                  <div className="text-right"><p className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-900">{dueLabel(item)}</p><p className="mt-1 text-xs text-slate-500">{formatDate(new Date(`${item.dueDate}T12:00:00.000Z`))}</p></div>
                </div>
                <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-3">
                  <div><dt className="font-medium text-slate-500">Who</dt><dd className="mt-1 text-slate-900">{item.who}</dd></div>
                  <div><dt className="font-medium text-slate-500">Why</dt><dd className="mt-1 text-slate-900">{item.reason}</dd></div>
                  <div><dt className="font-medium text-slate-500">Next step</dt><dd className="mt-1 text-slate-900">{item.nextAction}</dd></div>
                </dl>
                {item.waitingOn && <p className="mt-4 text-sm text-slate-600"><span className="font-medium">Waiting on:</span> {item.waitingOn}</p>}
                <Link className="mt-5 inline-block rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800" href={`/jobs/${item.jobId}#attention-actions`}>Open follow-up actions</Link>
              </li>
            ))}
          </ol>
        ) : <section className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-8"><h3 className="text-xl font-semibold text-emerald-950">Nothing is due today.</h3><p className="mt-2 text-sm text-emerald-900">Future follow-up dates will appear here when they become due.</p></section>}
      </section>

      <p className="mt-6 text-xs text-slate-500">Default reminders: Outreach 3 days · RTR 2 days · Client submission 5 days · Interview 1 day.</p>
    </div>
  );
}
