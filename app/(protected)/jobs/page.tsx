import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { formatDate, formatEnum } from "@/lib/job-values";
import { getPrisma } from "@/lib/prisma";

export default async function JobsPage() {
  await requireAuth();
  const jobs = await getPrisma().opportunity.findMany({
    include: { applicationTrack: true, recruiter: true, vendor: true },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Jobs</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Opportunities</h1>
        </div>
        <Link className="rounded-lg bg-slate-950 px-4 py-2.5 font-medium text-white hover:bg-slate-800" href="/jobs/new">
          Add job
        </Link>
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {jobs.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-5 py-3 font-medium" scope="col">Job</th>
                  <th className="px-5 py-3 font-medium" scope="col">Recruiter / vendor</th>
                  <th className="px-5 py-3 font-medium" scope="col">Stage</th>
                  <th className="px-5 py-3 font-medium" scope="col">Next follow-up</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {jobs.map((job) => (
                  <tr className="hover:bg-slate-50" key={job.id}>
                    <td className="px-5 py-4">
                      <Link className="font-semibold text-slate-950 underline" href={`/jobs/${job.id}`}>{job.title}</Link>
                      <span className="mt-1 block text-slate-600">{job.client ?? "Client not set"}</span>
                    </td>
                    <td className="px-5 py-4 text-slate-700">
                      {job.recruiter?.name ?? "Not set"}
                      <span className="mt-1 block text-slate-500">{job.vendor?.name ?? "Vendor not set"}</span>
                    </td>
                    <td className="px-5 py-4 font-medium text-emerald-800">{formatEnum(job.applicationTrack?.currentStage ?? "DISCOVERED")}</td>
                    <td className="px-5 py-4 text-slate-700">{formatDate(job.applicationTrack?.nextFollowUpAt ?? null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-10 text-center">
            <p className="text-slate-600">No opportunities have been added.</p>
            <Link className="mt-3 inline-block font-medium text-emerald-700 underline" href="/jobs/new">Add the first job</Link>
          </div>
        )}
      </div>
    </div>
  );
}
