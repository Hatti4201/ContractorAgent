import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { formatDate } from "@/lib/job-values";
import { getPrisma } from "@/lib/prisma";

export default async function RecruitersPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireAuth();
  const { error } = await searchParams;
  // ponytail: a single user tracks tens of recruiters, so the latest touch is computed here instead of in SQL.
  const recruiters = await getPrisma().recruiter.findMany({
    include: {
      vendor: { select: { name: true } },
      opportunities: { select: { updatedAt: true } },
    },
    orderBy: { name: "asc" },
  });
  const rows = recruiters.map((recruiter) => ({
    ...recruiter,
    lastTouch: recruiter.opportunities.reduce<Date | null>(
      (latest, job) => (!latest || job.updatedAt > latest ? job.updatedAt : latest),
      null,
    ),
  }));

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Contacts</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Recruiters</h1>
      <p className="mt-3 max-w-3xl text-slate-600">Every recruiter reached through an opportunity, with the jobs they are attached to. Contact details stay in the private database.</p>

      {error === "missing" && <p className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800" role="alert">That recruiter no longer exists.</p>}

      <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-5 py-3 font-medium" scope="col">Recruiter</th>
                  <th className="px-5 py-3 font-medium" scope="col">Vendor</th>
                  <th className="px-5 py-3 font-medium" scope="col">Jobs</th>
                  <th className="px-5 py-3 font-medium" scope="col">Last job update</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rows.map((recruiter) => (
                  <tr className="hover:bg-slate-50" key={recruiter.id}>
                    <td className="px-5 py-4">
                      <Link className="font-semibold text-slate-950 underline" href={`/recruiters/${recruiter.id}`}>{recruiter.name}</Link>
                      <span className="mt-1 block break-all text-slate-600">{recruiter.email ?? "No email"}</span>
                    </td>
                    <td className="px-5 py-4 text-slate-700">{recruiter.vendor?.name ?? "Not set"}</td>
                    <td className="px-5 py-4 font-medium text-emerald-800">{recruiter.opportunities.length}</td>
                    <td className="px-5 py-4 text-slate-700">{formatDate(recruiter.lastTouch)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-10 text-center">
            <p className="text-slate-600">No recruiter has been recorded yet.</p>
            <Link className="mt-3 inline-block font-medium text-emerald-700 underline" href="/jobs/new">Add a job with a recruiter</Link>
          </div>
        )}
      </div>
    </div>
  );
}
