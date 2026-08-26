import Link from "next/link";
import { Highlight, MarkedText } from "@/components/highlight";
import { requireAuth } from "@/lib/auth";
import { formatDate, formatEnum } from "@/lib/job-values";
import { getPrisma } from "@/lib/prisma";
import { hiddenMatches, searchJobs, type SearchedJob } from "@/services/job-search";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireAuth();
  const { q } = await searchParams;
  const term = (typeof q === "string" ? q : "").trim().slice(0, 200);

  const search = term ? await searchJobs(term) : null;
  const jobs: SearchedJob[] = search?.jobs ?? await getPrisma().opportunity.findMany({
    include: {
      applicationTrack: true,
      recruiter: true,
      vendor: true,
      selectedResume: true,
      outreachDraft: { select: { subject: true, body: true, sentSubject: true, sentBody: true, toAddress: true } },
      activities: { select: { description: true }, take: 0 },
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Jobs</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Opportunities</h1>
        </div>
        <Link className="rounded-lg bg-slate-950 px-4 py-2.5 font-medium text-white hover:bg-slate-800" href="/intake">
          Add job
        </Link>
      </div>

      <form action="/jobs" className="mt-8 flex flex-wrap items-center gap-3">
        <label className="min-w-64 flex-1 text-sm font-medium text-slate-800">
          <span className="sr-only">Search jobs</span>
          <input autoFocus className={inputClass} defaultValue={term} maxLength={200} name="q" placeholder="Phone number, recruiter, client, or any words from the JD or the email" type="search" />
        </label>
        <button className="rounded-lg bg-slate-950 px-4 py-2.5 font-medium text-white hover:bg-slate-800" type="submit">Search</button>
        {term && <Link className="text-sm font-medium text-emerald-700 underline" href="/jobs">Clear</Link>}
      </form>
      {term && (
        <p className="mt-3 text-sm text-slate-600">
          {jobs.length ? `${jobs.length}${search?.truncated ? "+" : ""} matching ${jobs.length === 1 ? "job" : "jobs"}` : "No match"} for “{term}”. A phone number matches however it was typed in.
        </p>
      )}

      <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
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
                {jobs.map((job) => {
                  const snippets = term ? hiddenMatches(job, term) : [];
                  const phoneOnly = Boolean(job.recruiterId && search?.phoneMatched.has(job.recruiterId));
                  return (
                    <tr className="hover:bg-slate-50" key={job.id}>
                      <td className="px-5 py-4">
                        <Link className="font-semibold text-slate-950 underline" href={`/jobs/${job.id}`}><Highlight term={term} text={job.title} /></Link>
                        <span className="mt-1 block text-slate-600">
                          <Highlight term={term} text={job.client ?? "Client not set"} /> · {job.roleFamily ? formatEnum(job.roleFamily) : "Role not set"}
                        </span>
                        <span className="mt-1 block text-xs text-slate-500">
                          Resume: {job.selectedResume
                            ? <><Highlight term={term} text={job.selectedResume.name} /> <Highlight term={term} text={job.selectedResume.version} /></>
                            : "not selected"}
                        </span>
                        {snippets.map((snippet, index) => (
                          <span className="mt-1 block text-xs text-slate-500" key={index}>
                            <span className="font-medium text-slate-700">{snippet.label}:</span> {snippet.before}<MarkedText>{snippet.match}</MarkedText>{snippet.after}
                          </span>
                        ))}
                      </td>
                      <td className="px-5 py-4 text-slate-700">
                        <Highlight term={term} text={job.recruiter?.name ?? "Not set"} />
                        {job.recruiter?.phone && (
                          <span className="mt-1 block text-slate-600">
                            {phoneOnly ? <MarkedText>{job.recruiter.phone}</MarkedText> : <Highlight term={term} text={job.recruiter.phone} />}
                          </span>
                        )}
                        <span className="mt-1 block text-slate-500"><Highlight term={term} text={job.vendor?.name ?? "Vendor not set"} /></span>
                      </td>
                      <td className="px-5 py-4 font-medium text-emerald-800">{formatEnum(job.applicationTrack?.currentStage ?? "DISCOVERED")}</td>
                      <td className="px-5 py-4 text-slate-700">{formatDate(job.applicationTrack?.nextFollowUpAt ?? null)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-10 text-center">
            <p className="text-slate-600">{term ? `Nothing matches “${term}”.` : "No opportunities have been added."}</p>
            <Link className="mt-3 inline-block font-medium text-emerald-700 underline" href={term ? "/jobs" : "/intake"}>{term ? "Show every job" : "Add the first job"}</Link>
          </div>
        )}
      </div>
    </div>
  );
}
