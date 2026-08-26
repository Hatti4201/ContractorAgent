import Link from "next/link";
import { IntakeForm } from "@/components/intake-form";
import {
  ApplicationStage,
  EmploymentType,
  FollowUpStatus,
  RoleFamily,
} from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";
import { requireAuth } from "@/lib/auth";
import { applicationStages, employmentTypes, formatDateTime, formatEnum, roleFamilies } from "@/lib/job-values";
import { getPrisma } from "@/lib/prisma";
import {
  dashboardMetrics,
  summarizeDashboard,
  timeRanges,
  type DashboardMetricKey,
  type TimeRange,
} from "@/services/dashboard-analytics";
import { buildAttentionItems, configuredTimeZone } from "@/services/attention";

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

function PerformanceTable({
  title,
  rows,
  filter,
  filters,
}: {
  title: string;
  rows: ReturnType<typeof summarizeDashboard>["vendorPerformance"];
  filter: "vendor" | "recruiter";
  filters: Filters;
}) {
  return (
    <section>
      <h2 className="text-xl font-semibold text-slate-950">{title}</h2>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        {rows.length ? (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium" scope="col">Name</th>
                {dashboardMetrics.map((metric) => (
                  <th className="px-3 py-3 text-right font-medium" key={metric.key} scope="col">{metric.key === "total" ? "Jobs" : formatEnum(metric.key)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="whitespace-nowrap px-4 py-3 font-medium">
                    <Link className="text-emerald-700 underline" href={dashboardHref(filters, { [filter]: row.id })}>{row.name}</Link>
                  </td>
                  {dashboardMetrics.map((metric) => <td className="px-3 py-3 text-right text-slate-700" key={metric.key}>{row[metric.key]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="p-6 text-sm text-slate-600">No matching activity in this time range.</p>}
      </div>
    </section>
  );
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
  const roleFamily = validValue(filters.role, Object.values(RoleFamily));
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
  const [opportunities, vendors, recruiters, attentionOpportunities, emailAttentionCount] = await Promise.all([
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
  ]);
  const summary = summarizeDashboard(opportunities, filters.range);
  const attentionCount = buildAttentionItems(attentionOpportunities, new Date(), configuredTimeZone()).length + emailAttentionCount;
  const selectedMetric = dashboardMetrics.find((metric) => metric.key === filters.metric)!;
  // Only our own redirect writes this, so anything that is not a plain id is ignored rather than linked.
  const sentJobId = typeof query.sent === "string" && /^[a-z0-9]+$/i.test(query.sent) ? query.sent : null;

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Overview</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Marketing funnel</h1>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 font-medium text-amber-950 hover:border-amber-500" href="/needs-attention">
            Needs attention ({attentionCount})
          </Link>
          <Link className="rounded-lg bg-slate-950 px-4 py-2.5 font-medium text-white hover:bg-slate-800" href="/intake">
            Add job
          </Link>
        </div>
      </div>

      {sentJobId && (
        <p className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-900" role="status">
          Outlook confirmed the send, and the version you actually sent is archived. <Link className="underline" href={`/jobs/${sentJobId}/outreach`}>Open the archived email</Link>
        </p>
      )}

      <section className="mt-8 rounded-2xl border-2 border-emerald-600 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">Add a job</h2>
            <p className="mt-1 text-sm text-slate-600">Paste the job post, LinkedIn message, recruiter email or forwarded JD. Analysis, resume routing and the draft all run in the background.</p>
          </div>
          <Link className="text-sm font-medium text-emerald-700 underline" href="/intake">Sources waiting for review, or enter a job manually →</Link>
        </div>
        <div className="mt-5"><IntakeForm autoFocus={false} hint={false} rows={5} /></div>
      </section>

      <section aria-label="Time range" className="mt-8 flex flex-wrap gap-2">
        {timeRanges.map((range) => (
          <Link
            aria-current={filters.range === range ? "page" : undefined}
            className={`rounded-full px-4 py-2 text-sm font-medium ${filters.range === range ? "bg-slate-950 text-white" : "border border-slate-300 bg-white text-slate-700 hover:border-slate-500"}`}
            href={dashboardHref(filters, { range })}
            key={range}
          >
            {rangeLabels[range]}
          </Link>
        ))}
      </section>

      <form className="mt-5 grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-5" method="get">
        <input name="range" type="hidden" value={filters.range} />
        <label className="text-sm font-medium text-slate-700">
          Role
          <select className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2" defaultValue={filters.role} name="role">
            <option value="">All roles</option>
            {roleFamilies.map((item) => <option key={item} value={item}>{formatEnum(item)}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-700">
          Vendor
          <select className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2" defaultValue={filters.vendor} name="vendor">
            <option value="">All vendors</option>
            {vendors.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-700">
          Recruiter
          <select className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2" defaultValue={filters.recruiter} name="recruiter">
            <option value="">All recruiters</option>
            {recruiters.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-700">
          Stage
          <select className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2" defaultValue={filters.stage} name="stage">
            <option value="">All stages</option>
            {applicationStages.map((item) => <option key={item} value={item}>{formatEnum(item)}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-700">
          Employment
          <select className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2" defaultValue={filters.employment} name="employment">
            <option value="">All types</option>
            {employmentTypes.map((item) => <option key={item} value={item}>{formatEnum(item)}</option>)}
          </select>
        </label>
        <div className="flex items-center gap-4 sm:col-span-2 lg:col-span-5">
          <button className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-medium text-white" type="submit">Apply filters</button>
          <Link className="text-sm font-medium text-emerald-700 underline" href="/dashboard">Reset</Link>
        </div>
      </form>

      <section aria-label="Funnel metrics" className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {dashboardMetrics.map((metric) => (
          <Link
            aria-current={filters.metric === metric.key ? "true" : undefined}
            className={`rounded-2xl border bg-white p-5 shadow-sm hover:border-emerald-500 ${filters.metric === metric.key ? "border-emerald-600 ring-2 ring-emerald-100" : "border-slate-200"}`}
            href={dashboardHref(filters, { metric: metric.key }, "#metric-details")}
            key={metric.key}
          >
            <span className="block text-sm font-medium text-slate-600">{metric.label}</span>
            <span className="mt-2 block text-3xl font-semibold text-slate-950">{summary.counts[metric.key]}</span>
          </Link>
        ))}
      </section>
      <p className="mt-3 text-xs text-slate-500">Unique opportunities in the selected UTC window; Total uses created date.</p>

      <section className="mt-10">
        <h2 className="text-xl font-semibold text-slate-950">Conversion rate</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {summary.conversions.map((conversion) => (
            <article className="rounded-2xl border border-slate-200 bg-white p-5" key={conversion.label}>
              <p className="text-sm font-medium text-slate-600">{conversion.label}</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{conversion.rate === null ? "—" : `${Math.round(conversion.rate * 100)}%`}</p>
              <p className="mt-1 text-xs text-slate-500">{conversion.numerator} / {conversion.denominator} jobs</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold text-slate-950">Pipeline</h2>
        <p className="mt-1 text-sm text-slate-600">Current stage for jobs created or active in the selected UTC window.</p>
        <div className="mt-4 grid gap-4 lg:grid-cols-5">
          {summary.pipeline.map((column) => (
            <article className="rounded-2xl border border-slate-200 bg-slate-100 p-3" key={column.key}>
              <div className="flex items-center justify-between px-1 py-1">
                <h3 className="font-semibold text-slate-950">{column.label}</h3>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-600">{column.jobs.length}</span>
              </div>
              <ul className="mt-2 space-y-2">
                {column.jobs.map((job) => (
                  <li key={job.id}>
                    <Link className="block rounded-xl border border-slate-200 bg-white p-3 hover:border-emerald-500" href={`/jobs/${job.id}`}>
                      <span className="block text-sm font-semibold text-slate-950">{job.title}</span>
                      <span className="mt-1 block text-xs text-slate-500">{job.client ?? "Client not set"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {!column.jobs.length ? <p className="px-1 py-4 text-center text-xs text-slate-500">No jobs</p> : null}
            </article>
          ))}
        </div>
      </section>

      <section className="mt-10" id="metric-details">
        <h2 className="text-xl font-semibold text-slate-950">{selectedMetric.label} details</h2>
        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {summary.details[filters.metric].length ? (
            <ul className="divide-y divide-slate-200">
              {summary.details[filters.metric].map((item) => (
                <li className="flex flex-wrap items-center justify-between gap-3 p-4" key={item.jobId}>
                  <span>
                    <Link className="font-semibold text-slate-950 underline" href={`/jobs/${item.jobId}`}>{item.title}</Link>
                    <span className="mt-1 block text-sm text-slate-500">{item.client ?? "Client not set"} · {formatEnum(item.type)}</span>
                  </span>
                  <time className="text-sm text-slate-500" dateTime={item.occurredAt.toISOString()}>{formatDateTime(item.occurredAt)} UTC</time>
                </li>
              ))}
            </ul>
          ) : <p className="p-6 text-sm text-slate-600">No matching opportunities.</p>}
        </div>
      </section>

      <div className="mt-10 grid gap-8 xl:grid-cols-2">
        <PerformanceTable filter="vendor" filters={filters} rows={summary.vendorPerformance} title="Vendor performance" />
        <PerformanceTable filter="recruiter" filters={filters} rows={summary.recruiterPerformance} title="Recruiter performance" />
      </div>
    </div>
  );
}
