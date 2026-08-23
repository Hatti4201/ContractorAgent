import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteRecruiter, mergeRecruiter, updateRecruiter } from "@/app/(protected)/recruiters/actions";
import { DeleteRecruiterForm } from "@/components/delete-job-form";
import { requireAuth } from "@/lib/auth";
import { formatDate, formatDateTime, formatEnum } from "@/lib/job-values";
import { getPrisma } from "@/lib/prisma";

const inputClass = "mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";
const cellInputClass = "w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";
const errors: Record<string, string> = {
  fields: "A name is required and the email must be a valid address.",
  "in-use": "This recruiter still has linked opportunities. Merge them into another recruiter first, or move them by editing each job.",
  "merge-target": "Choose a different recruiter to merge into.",
  "merge-failed": "The merge did not run and nothing changed. Reload the directory and try again.",
  linkedin: "The profile link must be a full https:// URL.",
  "email-taken": "Another recruiter already uses that email address.",
};

export default async function RecruiterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; edit?: string }>;
}) {
  await requireAuth();
  const { id } = await params;
  const { error, saved, edit } = await searchParams;
  const editing = edit === "1";
  const database = getPrisma();
  const recruiter = await database.recruiter.findUnique({
    where: { id },
    include: {
      vendor: { select: { name: true } },
      opportunities: {
        include: { applicationTrack: true, vendor: { select: { name: true } } },
        orderBy: { updatedAt: "desc" },
      },
    },
  });
  if (!recruiter) notFound();

  const others = await database.recruiter.findMany({
    where: { id: { not: id } },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });

  // Suggestions are matched by sender address, so a recruiter without an email has none to show.
  const suggestions = recruiter.email
    ? await database.followUpSuggestion.findMany({
        where: { fromAddress: recruiter.email.toLowerCase() },
        orderBy: { receivedAt: "desc" },
        take: 10,
      })
    : [];

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <Link className="text-sm font-medium text-emerald-700 underline" href="/recruiters">← All recruiters</Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Recruiter</p>
          {editing
            ? <input aria-label="Recruiter name" className="mt-2 w-full min-w-72 rounded-md border border-slate-300 bg-white px-2 py-1 text-3xl font-semibold tracking-tight text-slate-950 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" defaultValue={recruiter.name} form="recruiter-details" maxLength={200} name="name" required />
            : <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{recruiter.name}</h1>}
        </div>
        <p className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">{recruiter.opportunities.length} linked {recruiter.opportunities.length === 1 ? "job" : "jobs"}</p>
      </div>

      {saved && <p className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-900" role="status">Recruiter updated.</p>}
      {error && <p className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800" role="alert">{errors[error] ?? "Update failed."}</p>}

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <form action={updateRecruiter.bind(null, recruiter.id)} id="recruiter-details">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <h2 className="text-xl font-semibold text-slate-950">Contact details</h2>
            <div className="flex items-center gap-3">
              {editing ? (
                <>
                  <Link className="text-sm font-medium text-slate-600 underline" href={`/recruiters/${recruiter.id}`}>Cancel</Link>
                  <button className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800" type="submit">Save edits</button>
                </>
              ) : (
                <Link aria-label="Edit contact details" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-500" href={`/recruiters/${recruiter.id}?edit=1`} title="Edit contact details">✏️ Edit</Link>
              )}
            </div>
          </div>

          <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-medium text-slate-500">Vendor</dt>
              <dd className="mt-1 text-slate-900">
                {editing ? <input className={cellInputClass} defaultValue={recruiter.vendor?.name ?? ""} maxLength={200} name="vendorName" /> : recruiter.vendor?.name ?? "Not set"}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-slate-500">Email</dt>
              <dd className="mt-1 break-all text-slate-900">
                {editing ? <input className={cellInputClass} defaultValue={recruiter.email ?? ""} maxLength={320} name="email" type="email" /> : recruiter.email ?? "Not set"}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-slate-500">Phone</dt>
              <dd className="mt-1 text-slate-900">
                {editing ? <input className={cellInputClass} defaultValue={recruiter.phone ?? ""} maxLength={80} name="phone" type="tel" /> : recruiter.phone ?? "Not set"}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-slate-500">Profile</dt>
              <dd className="mt-1 break-all text-slate-900">
                {editing
                  ? <input className={cellInputClass} defaultValue={recruiter.linkedinUrl ?? ""} maxLength={500} name="linkedinUrl" placeholder="https://www.linkedin.com/in/…" type="url" />
                  : recruiter.linkedinUrl
                    ? <a className="font-medium text-emerald-700 underline" href={recruiter.linkedinUrl} rel="noreferrer noopener" target="_blank">{recruiter.linkedinUrl}</a>
                    : "Not set"}
              </dd>
            </div>
          </dl>

          <div className="mt-5 border-t border-slate-200 pt-5">
            <p className="text-sm font-medium text-slate-500">Notes</p>
            {editing
              ? <textarea className={`${cellInputClass} mt-1`} defaultValue={recruiter.notes ?? ""} maxLength={2000} name="notes" rows={4} />
              : <p className="mt-1 whitespace-pre-wrap text-sm text-slate-900">{recruiter.notes ?? "No notes."}</p>}
          </div>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold text-slate-950">Linked opportunities</h2>
        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {recruiter.opportunities.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-5 py-3 font-medium" scope="col">Job</th>
                    <th className="px-5 py-3 font-medium" scope="col">Stage</th>
                    <th className="px-5 py-3 font-medium" scope="col">Waiting on</th>
                    <th className="px-5 py-3 font-medium" scope="col">Next follow-up</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {recruiter.opportunities.map((job) => (
                    <tr className="hover:bg-slate-50" key={job.id}>
                      <td className="px-5 py-4">
                        <Link className="font-semibold text-slate-950 underline" href={`/jobs/${job.id}`}>{job.title}</Link>
                        <span className="mt-1 block text-slate-600">{job.client ?? "Client not set"} · {job.vendor?.name ?? "Vendor not set"}</span>
                      </td>
                      <td className="px-5 py-4 font-medium text-emerald-800">{formatEnum(job.applicationTrack?.currentStage ?? "DISCOVERED")}</td>
                      <td className="px-5 py-4 text-slate-700">{job.applicationTrack?.waitingOn ?? "Not set"}</td>
                      <td className="px-5 py-4 text-slate-700">{formatDate(job.applicationTrack?.nextFollowUpAt ?? null)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="p-10 text-center text-slate-600">No opportunity is linked to this recruiter.</p>}
        </div>
      </section>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-950">Merge or remove</h2>
        <p className="mt-1 text-sm text-slate-600">Merging moves every linked job to the other recruiter, fills only their empty contact fields, keeps anything it cannot carry in their notes, and records a correction on each moved job. It cannot be undone.</p>
        {others.length ? (
          <form action={mergeRecruiter.bind(null, recruiter.id)} className="mt-5 flex flex-wrap items-end gap-3">
            <label className="text-sm font-medium text-slate-800">
              Merge this recruiter into
              <select className={`${inputClass} min-w-72`} name="targetId" required>
                {others.map((other) => <option key={other.id} value={other.id}>{other.name}{other.email ? ` · ${other.email}` : ""}</option>)}
              </select>
            </label>
            <button className="rounded-lg border border-amber-400 bg-amber-50 px-4 py-2.5 font-medium text-amber-950 hover:border-amber-600" type="submit">
              Merge and delete this record
            </button>
          </form>
        ) : <p className="mt-5 text-sm text-slate-600">No other recruiter exists to merge into.</p>}

        <div className="mt-6 border-t border-slate-200 pt-6">
          {recruiter.opportunities.length ? (
            <p className="text-sm text-slate-600">Deleting is blocked while {recruiter.opportunities.length} {recruiter.opportunities.length === 1 ? "job is" : "jobs are"} linked, because that would silently leave them without a recruiter.</p>
          ) : <DeleteRecruiterForm action={deleteRecruiter.bind(null, recruiter.id)} />}
        </div>
      </section>

      {suggestions.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xl font-semibold text-slate-950">Recent email suggestions</h2>
          <ul className="mt-5 space-y-3">
            {suggestions.map((suggestion) => (
              <li className="rounded-xl border border-slate-200 bg-white p-4 text-sm" key={suggestion.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-slate-950">{suggestion.subject}</p>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{formatEnum(suggestion.status)}</span>
                </div>
                <p className="mt-1 text-slate-600">
                  {formatDateTime(suggestion.receivedAt)} UTC
                  {suggestion.event ? ` · ${formatEnum(suggestion.event)}` : ""}
                  {suggestion.opportunityId ? "" : " · Not linked to a job"}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500">Read-only here. Confirm or dismiss suggestions from <Link className="underline" href="/needs-attention">Needs attention</Link>.</p>
        </section>
      )}
    </div>
  );
}
