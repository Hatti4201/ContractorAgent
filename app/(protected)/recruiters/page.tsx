import Link from "next/link";
import { createRecruiter } from "@/app/(protected)/recruiters/actions";
import { requireAuth } from "@/lib/auth";
import { formatDate } from "@/lib/job-values";
import { getPrisma } from "@/lib/prisma";

const inputClass = "mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";
const errors: Record<string, string> = {
  missing: "That recruiter no longer exists.",
  fields: "A name is required and the email must be a valid address.",
  linkedin: "The profile link must be a full https:// URL.",
  "email-taken": "Another recruiter already uses that email address.",
};

export default async function RecruitersPage({ searchParams }: { searchParams: Promise<{ error?: string; deleted?: string }> }) {
  await requireAuth();
  const { error, deleted } = await searchParams;
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

      {deleted && <p className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-900" role="status">Recruiter deleted.</p>}
      {error && <p className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800" role="alert">{errors[error] ?? "Recruiter update failed."}</p>}

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-950">Add recruiter</h2>
        <form action={createRecruiter} className="mt-5 grid gap-5 md:grid-cols-2">
          <label className="text-sm font-medium text-slate-800">Name <span aria-hidden="true" className="text-red-700">*</span><input className={inputClass} maxLength={200} name="name" required /></label>
          <label className="text-sm font-medium text-slate-800">Vendor<input className={inputClass} maxLength={200} name="vendorName" /></label>
          <label className="text-sm font-medium text-slate-800">Email<input className={inputClass} maxLength={320} name="email" type="email" /></label>
          <label className="text-sm font-medium text-slate-800">Phone<input className={inputClass} maxLength={80} name="phone" type="tel" /></label>
          <label className="text-sm font-medium text-slate-800 md:col-span-2">LinkedIn or profile URL<input className={inputClass} maxLength={500} name="linkedinUrl" placeholder="https://www.linkedin.com/in/…" type="url" /></label>
          <label className="text-sm font-medium text-slate-800 md:col-span-2">Notes<textarea className={inputClass} maxLength={2000} name="notes" rows={3} /></label>
          <button className="w-fit rounded-lg bg-slate-950 px-5 py-3 font-medium text-white hover:bg-slate-800" type="submit">Add recruiter</button>
        </form>
      </section>

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
