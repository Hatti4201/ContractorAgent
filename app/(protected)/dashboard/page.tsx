import Link from "next/link";
import {
  ArrowRight, Briefcase, Building2, CalendarCheck, Filter, Handshake, MailSearch, MessageSquareReply, Phone, Plus,
  RotateCcw, Send, TriangleAlert, Trophy, UserRoundCheck, Users, type LucideIcon,
} from "lucide-react";
import { discardIntake } from "@/app/(protected)/intake/actions";
import { ExposureCard } from "@/components/exposure-card";
import { AutopilotPanel } from "@/components/autopilot-panel";
import { PendingStrip, type PendingItem } from "@/components/pending-strip";
import { PerformanceTable } from "@/components/performance-table";
import { Toast } from "@/components/toast";
import {
  ApplicationStage,
  EmploymentType,
  FollowUpStatus,
} from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";
import { requireAuth } from "@/lib/auth";
import { applicationStages, employmentTypes, formatDate, formatDateTime, formatEnum } from "@/lib/job-values";
import { allRoleFamilies } from "@/services/role-family";
import { getPrisma } from "@/lib/prisma";
import {
  dashboardMetrics,
  summarizeDashboard,
  timeRanges,
  type DashboardMetricKey,
  type PipelineColumnKey,
  type TimeRange,
} from "@/services/dashboard-analytics";
import { buildAttentionItems, configuredTimeZone } from "@/services/attention";
import { queuedIntakes } from "@/services/intake-queue";
import { checkSentDraftsNow, scanMailNow } from "@/app/(protected)/dashboard/actions";
import { listDraftsAwaitingOutlook, listUnsentDrafts } from "@/services/outreach-pipeline";

type Search = Record<string, string | string[] | undefined>;
type Filters = {
  range: TimeRange;
  role: string;
  vendor: string;
  recruiter: string;
  stage: string;
  employment: string;
  metric: DashboardMetricKey;
};

/** Only an https link Outlook itself gave us is ever offered to the browser. */
function safeOutlookLink(value: string | null) {
  if (!value) return null;
  try { return new URL(value).protocol === "https:" ? value : null; } catch { return null; }
}

const rangeLabels: Record<TimeRange, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  all: "All time",
};

function value(query: Search, key: string) {
  return typeof query[key] === "string" ? query[key] : "";
}

function validValue<T extends string>(candidate: string, allowed: readonly T[]) {
  return allowed.includes(candidate as T) ? (candidate as T) : undefined;
}

function dashboardHref(filters: Filters, changes: Partial<Filters> = {}, anchor = "") {
  const next = { ...filters, ...changes };
  const params = new URLSearchParams();
  for (const [key, item] of Object.entries(next)) {
    if (item && !(key === "range" && item === "all") && !(key === "metric" && item === "total")) {
      params.set(key, item);
    }
  }
  return `/dashboard${params.size ? `?${params}` : ""}${anchor}`;
}

const metricLook: Record<DashboardMetricKey, { icon: LucideIcon; short: string }> = {
  total: { icon: Briefcase, short: "Jobs" },
  outreach: { icon: Send, short: "Outreach" },
  replies: { icon: MessageSquareReply, short: "Replies" },
  calls: { icon: Phone, short: "Calls" },
  rtr: { icon: Handshake, short: "RTR" },
  submitted: { icon: UserRoundCheck, short: "Submitted" },
  interviews: { icon: CalendarCheck, short: "Interviews" },
  offers: { icon: Trophy, short: "Offers" },
};

const PIPELINE_PREVIEW = 10;
const DETAILS_PREVIEW = 3;

/** A job's fit as a dot: green from 70%, amber from 50%, grey below, none when unscored. */
function matchDot(score: number | null | undefined) {
  if (score === null || score === undefined) return null;
  return score >= 0.7 ? "bg-emerald-500" : score >= 0.5 ? "bg-amber-400" : "bg-slate-300";
}

function pipelineHref(column: PipelineColumnKey, jobId: string) {
  // A job still at outreach is about its email; later stages are about the job itself.
  return column === "outreach" ? `/jobs/${jobId}/outreach` : `/jobs/${jobId}`;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAuth();
  const query = await searchParams;
  const filters: Filters = {
    range: validValue(value(query, "range"), timeRanges) ?? "all",
    role: value(query, "role"),
    vendor: value(query, "vendor"),
    recruiter: value(query, "recruiter"),
    stage: value(query, "stage"),
    employment: value(query, "employment"),
    metric: validValue(value(query, "metric"), dashboardMetrics.map((item) => item.key)) ?? "total",
  };
  // Every family, not just the active ones: deactivating one must not hide the jobs already filed under it.
  const roleFamilies = await allRoleFamilies();
  const roleFamily = validValue(filters.role, roleFamilies.map((family) => family.code));
  const stage = validValue(filters.stage, Object.values(ApplicationStage));
  const employmentType = validValue(filters.employment, Object.values(EmploymentType));
  const where: Prisma.OpportunityWhereInput = {
    roleFamily,
    employmentType,
    recruiterId: filters.recruiter || undefined,
    vendorId: filters.vendor || undefined,
    applicationTrack: stage ? { is: { currentStage: stage } } : undefined,
  };
  const database = getPrisma();
  const [opportunities, vendors, recruiters, attentionOpportunities, emailAttentionCount, queue, waitingToSend, beingPrepared] = await Promise.all([
    database.opportunity.findMany({
      where,
      select: {
        id: true,
        title: true,
        client: true,
        createdAt: true,
        vendor: { select: { id: true, name: true } },
        recruiter: { select: { id: true, name: true } },
        applicationTrack: { select: { currentStage: true } },
        activities: { select: { type: true, occurredAt: true } },
        matchScore: true,
      },
      orderBy: { updatedAt: "desc" },
    }),
    database.vendor.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    database.recruiter.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    database.opportunity.findMany({
      select: {
        id: true,
        title: true,
        client: true,
        vendor: { select: { name: true } },
        recruiter: { select: { name: true } },
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
    database.followUpSuggestion.count({ where: { status: { in: [FollowUpStatus.PENDING, FollowUpStatus.FAILED] } } }),
    queuedIntakes(database),
    listUnsentDrafts(database),
    listDraftsAwaitingOutlook(database),
  ]);
  const summary = summarizeDashboard(opportunities, filters.range);
  const attentionCount = buildAttentionItems(attentionOpportunities, new Date(), configuredTimeZone()).length + emailAttentionCount;
  const selectedMetric = dashboardMetrics.find((metric) => metric.key === filters.metric)!;
  // Only our own redirect writes this, so anything that is not a plain id is ignored rather than linked.
  const sentJobId = typeof query.sent === "string" && /^[a-z0-9]+$/i.test(query.sent) ? query.sent : null;

  const activeFilters = [filters.role, filters.vendor, filters.recruiter, filters.stage, filters.employment].filter(Boolean).length;
  const metricColumns = dashboardMetrics.map((metric) => ({ key: metric.key, label: metricLook[metric.key].short, tip: metric.label }));
  const performanceRows = (rows: typeof summary.vendorPerformance, filter: "vendor" | "recruiter") => rows.map((row) => ({
    id: row.id,
    name: row.name,
    href: dashboardHref(filters, { [filter]: row.id }),
    values: dashboardMetrics.map((metric) => row[metric.key]),
  }));
  const pending = {
    preparing: beingPrepared.map((draft): PendingItem => ({
      id: draft.id,
      title: draft.opportunity.title,
      href: `/jobs/${draft.opportunityId}/outreach`,
      tip: [draft.opportunity.recruiter?.name, draft.state === "READY" ? "Ready for Outlook" : draft.state === "WRITING" ? "Writing" : "Needs review"].filter(Boolean).join(" · "),
      dot: draft.state === "READY" ? "green" : draft.state === "WRITING" ? "slate" : "amber",
    })),
    inOutlook: waitingToSend.map((draft): PendingItem => ({
      id: draft.id,
      title: draft.opportunity.title,
      href: `/jobs/${draft.opportunityId}/outreach`,
      tip: [draft.opportunity.recruiter?.name, draft.outlookDraftCreatedAt ? `built ${formatDateTime(draft.outlookDraftCreatedAt)}` : null].filter(Boolean).join(" · "),
      dot: "sky",
      outlookLink: safeOutlookLink(draft.outlookWebLink),
    })),
    review: queue.map((intake): PendingItem => ({
      id: intake.id,
      title: intake.title,
      href: `/intakes/${intake.id}/review`,
      tip: [intake.recruiterName, intake.detail].filter(Boolean).join(" · ") || null,
      dot: intake.state === "READY" ? "green" : intake.state === "STOPPED" ? "amber" : intake.state === "FAILED" ? "red" : "slate",
      match: intake.matchScore,
      discard: discardIntake.bind(null, intake.id, "/dashboard"),
    })),
  };
  const details = summary.details[filters.metric];

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {query.error === "missing" && <Toast clear={["error"]} text="Already confirmed or discarded" tone="warn" />}
      {sentJobId && <Toast clear={["sent"]} text="Sent · archived" />}

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full min-w-0 md:w-auto md:flex-1">
          <AutopilotPanel notice={{ autopilot: value(query, "autopilot"), cancelled: value(query, "cancelled"), autopilotRun: query.autopilotRun === undefined ? undefined : value(query, "autopilotRun") }} />
        </div>
        <div className="flex items-center gap-2 max-md:ml-auto">
          <Link aria-label={`Needs attention: ${attentionCount}`} className={`flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-semibold ${attentionCount ? "border-amber-300 bg-amber-50 text-amber-900 hover:border-amber-500" : "border-slate-200 bg-white text-slate-400"}`} href="/needs-attention" title="Needs attention">
            <TriangleAlert aria-hidden="true" size={17} /> {attentionCount}
          </Link>
          <form action={scanMailNow}>
            <button aria-label="Scan mail now" className="rounded-xl border border-slate-200 bg-white p-2.5 text-blue-700 hover:border-blue-500" title="Scan mail now" type="submit">
              <MailSearch aria-hidden="true" size={18} />
            </button>
          </form>
          <Link aria-label="Add a job" className="rounded-xl bg-slate-950 p-2.5 text-white hover:bg-slate-800" href="/intake" title="Add a job">
            <Plus aria-hidden="true" size={18} />
          </Link>
        </div>
      </div>

      <PendingStrip checkSent={checkSentDraftsNow} inOutlook={pending.inOutlook} preparing={pending.preparing} review={pending.review} />

      <div className="mt-6"><ExposureCard /></div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {timeRanges.map((range) => (
          <Link
            aria-current={filters.range === range ? "page" : undefined}
            className={`rounded-full px-3 py-1 text-sm font-medium ${filters.range === range ? "bg-slate-950 text-white" : "border border-slate-300 bg-white text-slate-600 hover:border-slate-500"}`}
            href={dashboardHref(filters, { range })}
            key={range}
          >
            {rangeLabels[range]}
          </Link>
        ))}
        <details className="relative ml-auto" open={activeFilters > 0}>
          <summary aria-label="Filters" className="flex cursor-pointer list-none items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-600 hover:border-slate-500 [&::-webkit-details-marker]:hidden" title="Filters">
            <Filter aria-hidden="true" size={14} />
            {activeFilters > 0 && <span className="rounded-full bg-slate-950 px-1.5 text-xs text-white">{activeFilters}</span>}
          </summary>
          <form className="absolute right-0 z-20 mt-2 grid w-72 gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-lg" method="get">
            <input name="range" type="hidden" value={filters.range} />
            {([
              ["role", "All roles", roleFamilies.map((family) => [family.code, family.label])],
              ["vendor", "All vendors", vendors.map((item) => [item.id, item.name])],
              ["recruiter", "All recruiters", recruiters.map((item) => [item.id, item.name])],
              ["stage", "All stages", applicationStages.map((item) => [item, formatEnum(item)])],
              ["employment", "All types", employmentTypes.map((item) => [item, formatEnum(item)])],
            ] as const).map(([name, all, options]) => (
              <select aria-label={all.replace("All ", "")} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" defaultValue={filters[name]} key={name} name={name}>
                <option value="">{all}</option>
                {options.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            ))}
            <div className="flex items-center justify-end gap-2">
              <Link aria-label="Reset filters" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" href="/dashboard" title="Reset"><RotateCcw aria-hidden="true" size={15} /></Link>
              <button aria-label="Apply filters" className="rounded-lg bg-slate-950 p-1.5 text-white" title="Apply" type="submit"><Filter aria-hidden="true" size={15} /></button>
            </div>
          </form>
        </details>
      </div>

      <section aria-label="Funnel metrics" className="mt-4 grid grid-cols-4 gap-2 lg:grid-cols-8">
        {dashboardMetrics.map((metric) => {
          const { icon: Icon, short } = metricLook[metric.key];
          const active = filters.metric === metric.key;
          return (
            <Link
              aria-current={active ? "true" : undefined}
              className={`rounded-xl border bg-white px-3 py-2 hover:border-emerald-500 ${active ? "border-emerald-600 ring-2 ring-emerald-100" : "border-slate-200"}`}
              href={dashboardHref(filters, { metric: metric.key }, "#metric-details")}
              key={metric.key}
              title={metric.label}
            >
              <span className="flex items-center gap-1.5 text-xs text-slate-500"><Icon aria-hidden="true" size={13} />{short}</span>
              <span className="mt-0.5 block text-2xl font-semibold text-slate-950">{summary.counts[metric.key]}</span>
            </Link>
          );
        })}
      </section>

      <section aria-label="Conversion" className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 sm:grid-cols-5">
        {summary.conversions.map((conversion) => (
          <div key={conversion.label} title={`${conversion.label}: ${conversion.numerator} / ${conversion.denominator} jobs`}>
            <div className="flex items-baseline justify-between text-xs text-slate-500">
              <span className="truncate">{conversion.label}</span>
              <span className="font-semibold text-slate-900">{conversion.rate === null ? "—" : `${Math.round(conversion.rate * 100)}%`}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-slate-100">
              <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${Math.round((conversion.rate ?? 0) * 100)}%` }} />
            </div>
          </div>
        ))}
      </section>

      <section aria-label="Pipeline" className="mt-6 grid gap-3 lg:grid-cols-5">
        {summary.pipeline.map((column) => {
          const hidden = column.jobs.length - PIPELINE_PREVIEW;
          return (
            <article className="rounded-2xl bg-slate-100 p-2" key={column.key}>
              <div className="flex items-center justify-between px-1.5 py-1">
                <h3 className="text-sm font-semibold text-slate-800">{column.label}</h3>
                <span className="rounded-full bg-white px-2 text-xs font-semibold text-slate-600">{column.jobs.length}</span>
              </div>
              <ul className="mt-1 space-y-1.5">
                {column.jobs.slice(0, PIPELINE_PREVIEW).map((job) => {
                  const dot = matchDot(job.matchScore);
                  return (
                    <li key={job.id}>
                      <Link
                        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 hover:border-emerald-500"
                        href={pipelineHref(column.key, job.id)}
                        title={[job.client ?? "Client not set", job.matchScore != null ? `${Math.round(job.matchScore * 100)}% match` : null].filter(Boolean).join(" · ")}
                      >
                        {dot && <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />}
                        <span className="truncate text-sm font-medium text-slate-900">{job.title}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {hidden > 0 && (
                <Link aria-label={`All ${column.jobs.length} ${column.label} jobs`} className="mt-1.5 flex items-center justify-end gap-1 px-1.5 text-sm font-semibold text-slate-500 hover:text-slate-950" href={`/jobs?stage=${column.key}`} title="See all">
                  +{hidden} <ArrowRight aria-hidden="true" size={14} />
                </Link>
              )}
              {!column.jobs.length && <p className="py-3 text-center text-sm text-slate-300">—</p>}
            </article>
          );
        })}
      </section>

      <section aria-label={`${selectedMetric.label} details`} className="mt-6 scroll-mt-6" id="metric-details">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-950">
            {(() => { const Icon = metricLook[filters.metric].icon; return <Icon aria-hidden="true" className="text-slate-500" size={18} />; })()}
            {selectedMetric.label}
          </h2>
          <Link aria-label="All jobs" className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-950" href="/jobs" title="See all">
            <ArrowRight aria-hidden="true" size={17} />
          </Link>
        </div>
        <div className="mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {details.length ? (
            <ul className="divide-y divide-slate-100">
              {details.slice(0, DETAILS_PREVIEW + 1).map((item, index) => (
                <li className={`flex items-center justify-between gap-3 px-4 py-2.5 ${index === DETAILS_PREVIEW ? "opacity-35" : ""}`} key={item.jobId}>
                  <Link className="truncate text-sm font-medium text-slate-900 hover:text-emerald-700" href={`/jobs/${item.jobId}`} title={`${item.client ?? "Client not set"} · ${formatEnum(item.type)}`}>{item.title}</Link>
                  <time className="shrink-0 text-xs text-slate-400" dateTime={item.occurredAt.toISOString()} title={formatDateTime(item.occurredAt)}>{formatDate(item.occurredAt)}</time>
                </li>
              ))}
            </ul>
          ) : <p className="p-4 text-center text-sm text-slate-300">—</p>}
          {details.length > DETAILS_PREVIEW + 1 && (
            <Link className="flex items-center justify-center gap-1 border-t border-slate-100 py-1.5 text-sm font-semibold text-slate-500 hover:text-slate-950" href="/jobs" title="See all">
              +{details.length - DETAILS_PREVIEW} <ArrowRight aria-hidden="true" size={14} />
            </Link>
          )}
        </div>
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <PerformanceTable columns={metricColumns} icon={<Building2 aria-hidden="true" className="text-slate-500" size={18} />} rows={performanceRows(summary.vendorPerformance, "vendor")} title="Vendors" />
        <PerformanceTable columns={metricColumns} icon={<Users aria-hidden="true" className="text-slate-500" size={18} />} more="/recruiters" rows={performanceRows(summary.recruiterPerformance, "recruiter")} title="Recruiters" />
      </div>
    </div>
  );
}
