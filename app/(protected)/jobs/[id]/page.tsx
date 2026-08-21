import Link from "next/link";
import { notFound } from "next/navigation";
import { addActivity, deleteJob, updateJob } from "@/app/(protected)/jobs/actions";
import { DeleteJobForm } from "@/components/delete-job-form";
import { JobForm } from "@/components/job-form";
import { requireAuth } from "@/lib/auth";
import { activityTypes, dateInputValue, formatDate, formatDateTime, formatEnum } from "@/lib/job-values";
import { getPrisma } from "@/lib/prisma";

const inputClass =
  "mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id } = await params;
  const job = await getPrisma().opportunity.findUnique({
    where: { id },
    include: {
      applicationTrack: true,
      recruiter: true,
      vendor: true,
      activities: { orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }] },
    },
  });
  if (!job?.applicationTrack) notFound();

  const update = updateJob.bind(null, job.id);
  const add = addActivity.bind(null, job.id);
  const remove = deleteJob.bind(null, job.id);

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <Link className="text-sm font-medium text-emerald-700 underline" href="/jobs">← All jobs</Link>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">{formatEnum(job.applicationTrack.currentStage)}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{job.title}</h1>
          <p className="mt-2 text-slate-600">{job.client ?? "Client not set"} · {job.location ?? "Location not set"}</p>
        </div>
        <DeleteJobForm action={remove} />
      </div>

      <section aria-label="Application track" className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Current stage", formatEnum(job.applicationTrack.currentStage)],
          ["Waiting on", job.applicationTrack.waitingOn ?? "Not set"],
          ["Next action", job.applicationTrack.nextAction ?? "Not set"],
          ["Next follow-up", formatDate(job.applicationTrack.nextFollowUpAt)],
        ].map(([label, value]) => (
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" key={label}>
            <p className="text-sm font-medium text-slate-500">{label}</p>
            <p className="mt-2 font-semibold text-slate-950">{value}</p>
          </article>
        ))}
      </section>

      <div className="mt-10 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.65fr)]">
        <section>
          <h2 className="text-xl font-semibold text-slate-950">Edit job</h2>
          <div className="mt-4">
            <JobForm
              action={update}
              initial={{
                title: job.title,
                client: job.client,
                location: job.location,
                employmentType: job.employmentType,
                workArrangement: job.workArrangement,
                rawJd: job.rawJd,
                vendorName: job.vendor?.name,
                recruiterName: job.recruiter?.name,
                recruiterEmail: job.recruiter?.email,
                recruiterPhone: job.recruiter?.phone,
                currentStage: job.applicationTrack.currentStage,
                waitingOn: job.applicationTrack.waitingOn,
                nextAction: job.applicationTrack.nextAction,
                nextFollowUpAt: dateInputValue(job.applicationTrack.nextFollowUpAt),
              }}
              submitLabel="Save changes"
            />
          </div>
        </section>

        <aside>
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-950">Add activity</h2>
            <form action={add} className="mt-5 space-y-4">
              <label className="block text-sm font-medium text-slate-800">
                Type
                <select className={inputClass} defaultValue="NOTE" name="type">
                  {activityTypes.map((value) => <option key={value} value={value}>{formatEnum(value)}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-800">
                Date and time (UTC)
                <input className={inputClass} name="occurredAt" type="datetime-local" />
              </label>
              <label className="block text-sm font-medium text-slate-800">
                Description <span aria-hidden="true" className="text-red-700">*</span>
                <textarea className={inputClass} maxLength={2000} name="description" required rows={4} />
              </label>
              <button className="rounded-lg bg-slate-950 px-4 py-2.5 font-medium text-white hover:bg-slate-800" type="submit">Add activity</button>
            </form>
          </section>

          <section className="mt-8">
            <h2 className="text-xl font-semibold text-slate-950">Timeline</h2>
            {job.activities.length ? (
              <ol className="mt-5 space-y-4 border-l-2 border-slate-200 pl-5">
                {job.activities.map((activity) => (
                  <li className="relative rounded-xl border border-slate-200 bg-white p-4" key={activity.id}>
                    <span aria-hidden="true" className="absolute -left-[1.72rem] top-5 h-3 w-3 rounded-full bg-emerald-600 ring-4 ring-slate-50" />
                    <p className="text-sm font-semibold text-emerald-800">{formatEnum(activity.type)}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{activity.description}</p>
                    <time className="mt-2 block text-xs text-slate-500" dateTime={activity.occurredAt.toISOString()}>{formatDateTime(activity.occurredAt)} UTC</time>
                  </li>
                ))}
              </ol>
            ) : <p className="mt-4 text-sm text-slate-600">No activity recorded.</p>}
          </section>
        </aside>
      </div>
    </div>
  );
}
