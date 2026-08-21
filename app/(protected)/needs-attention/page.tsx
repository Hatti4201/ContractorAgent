import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { formatDate, formatEnum } from "@/lib/job-values";
import { getPrisma } from "@/lib/prisma";
import { buildAttentionItems, configuredTimeZone, type AttentionItem } from "@/services/attention";

function dueLabel(item: AttentionItem) {
  if (!item.daysOverdue) return "Due today";
  return `${item.daysOverdue} day${item.daysOverdue === 1 ? "" : "s"} overdue`;
}

export default async function NeedsAttentionPage() {
  await requireAuth();
  const opportunities = await getPrisma().opportunity.findMany({
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
  });
  const timeZone = configuredTimeZone();
  const items = buildAttentionItems(opportunities, new Date(), timeZone);

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Follow-up system</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Needs attention</h1>
          <p className="mt-2 text-slate-600">{items.length} item{items.length === 1 ? "" : "s"} due · Calendar timezone: {timeZone}</p>
        </div>
        <Link className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 font-medium text-slate-700 hover:border-slate-500" href="/jobs">
          All jobs
        </Link>
      </div>

      {items.length ? (
        <ol className="mt-8 grid gap-5 lg:grid-cols-2">
          {items.map((item) => (
            <li className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" key={item.jobId}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-emerald-800">{formatEnum(item.stage)}</p>
                  <h2 className="mt-1 text-xl font-semibold text-slate-950">{item.title}</h2>
                  <p className="mt-1 text-sm text-slate-600">{item.client ?? "Client not set"}</p>
                </div>
                <div className="text-right">
                  <p className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-900">{dueLabel(item)}</p>
                  <p className="mt-1 text-xs text-slate-500">{formatDate(new Date(`${item.dueDate}T12:00:00.000Z`))}</p>
                </div>
              </div>
              <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-3">
                <div><dt className="font-medium text-slate-500">Who</dt><dd className="mt-1 text-slate-900">{item.who}</dd></div>
                <div><dt className="font-medium text-slate-500">Why</dt><dd className="mt-1 text-slate-900">{item.reason}</dd></div>
                <div><dt className="font-medium text-slate-500">Next step</dt><dd className="mt-1 text-slate-900">{item.nextAction}</dd></div>
              </dl>
              {item.waitingOn && <p className="mt-4 text-sm text-slate-600"><span className="font-medium">Waiting on:</span> {item.waitingOn}</p>}
              <Link className="mt-5 inline-block rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800" href={`/jobs/${item.jobId}#attention-actions`}>
                Open follow-up actions
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <section className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50 p-8">
          <h2 className="text-xl font-semibold text-emerald-950">Nothing needs attention today.</h2>
          <p className="mt-2 text-sm text-emerald-900">Future follow-up dates will appear here when they become due.</p>
        </section>
      )}

      <p className="mt-6 text-xs text-slate-500">Default reminders: Outreach 3 days · RTR 2 days · Client submission 5 days · Interview 1 day.</p>
    </div>
  );
}
