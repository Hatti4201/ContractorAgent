import Link from "next/link";
import { ApplicationStage } from "@/app/generated/prisma/enums";
import { requireAuth } from "@/lib/auth";
import { formatDate, formatEnum } from "@/lib/job-values";
import { getPrisma } from "@/lib/prisma";

const terminalStages = [
  ApplicationStage.HIRED,
  ApplicationStage.NO_RESPONSE,
  ApplicationStage.REJECTED,
  ApplicationStage.ROLE_CLOSED,
  ApplicationStage.WITHDRAWN,
  ApplicationStage.DUPLICATE,
];

export default async function DashboardPage() {
  await requireAuth();
  const database = getPrisma();
  const [total, active, followUps, recent] = await Promise.all([
    database.opportunity.count(),
    database.applicationTrack.count({ where: { currentStage: { notIn: terminalStages } } }),
    database.applicationTrack.count({ where: { nextFollowUpAt: { not: null } } }),
    database.opportunity.findMany({
      include: { applicationTrack: true, recruiter: true },
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Dashboard</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Job tracker</h1>
        </div>
        <Link className="rounded-lg bg-slate-950 px-4 py-2.5 font-medium text-white hover:bg-slate-800" href="/jobs/new">
          Add job
        </Link>
      </div>

      <section aria-label="Job summary" className="mt-8 grid gap-4 sm:grid-cols-3">
        {[["Total jobs", total], ["Active tracks", active], ["Follow-ups set", followUps]].map(([label, value]) => (
          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" key={label}>
            <p className="text-sm font-medium text-slate-600">{label}</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{value}</p>
          </article>
        ))}
      </section>

      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-slate-950">Recently updated</h2>
          <Link className="text-sm font-medium text-emerald-700 underline" href="/jobs">View all jobs</Link>
        </div>
        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {recent.length ? (
            <ul className="divide-y divide-slate-200">
              {recent.map((job) => (
                <li key={job.id}>
                  <Link className="flex flex-wrap items-center justify-between gap-3 p-5 hover:bg-slate-50" href={`/jobs/${job.id}`}>
                    <span>
                      <span className="block font-semibold text-slate-950">{job.title}</span>
                      <span className="mt-1 block text-sm text-slate-600">{job.client ?? "Client not set"} · {job.recruiter?.name ?? "Recruiter not set"}</span>
                    </span>
                    <span className="text-right text-sm">
                      <span className="block font-medium text-emerald-800">{formatEnum(job.applicationTrack?.currentStage ?? "DISCOVERED")}</span>
                      <span className="mt-1 block text-slate-500">Follow-up {formatDate(job.applicationTrack?.nextFollowUpAt ?? null)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-8 text-center text-slate-600">No jobs yet. Add the first opportunity to start tracking.</div>
          )}
        </div>
      </section>
    </div>
  );
}
