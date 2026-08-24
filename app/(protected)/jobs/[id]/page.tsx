import Link from "next/link";
import { notFound } from "next/navigation";
import { generateOutreachDraft } from "@/app/(protected)/jobs/[id]/outreach/actions";
import { addActivity, completeAttention, deleteJob, rescheduleAttention, selectResume, updateJob, updateJobCase } from "@/app/(protected)/jobs/actions";
import { DeleteJobForm } from "@/components/delete-job-form";
import { GenerateOutreachButton } from "@/components/generate-outreach-button";
import { JobForm } from "@/components/job-form";
import { requireAuth } from "@/lib/auth";
import { activityTypes, dateInputValue, formatDate, formatDateTime, formatEnum } from "@/lib/job-values";
import { getPrisma } from "@/lib/prisma";
import { buildAttentionItems, configuredTimeZone } from "@/services/attention";
import { parseJobCase, type JobCase } from "@/services/job-case";
import { buildResumeRoute, checkResumeFile } from "@/services/resume-router";

const cellInputClass =
  "w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";
const inputClass =
  "mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";

export default async function JobDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ outreachError?: string; edit?: string }> }) {
  await requireAuth();
  const [{ id }, { outreachError, edit }] = await Promise.all([params, searchParams]);
  const editingCase = edit === "case";
  const database = getPrisma();
  const [job, resumes] = await Promise.all([
    database.opportunity.findUnique({
      where: { id },
      include: {
        applicationTrack: true,
        recruiter: true,
        vendor: true,
        selectedResume: true,
        outreachDraft: true,
        activities: { orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }] },
      },
    }),
    database.resume.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }),
  ]);
  if (!job?.applicationTrack) notFound();

  const update = updateJob.bind(null, job.id);
  const add = addActivity.bind(null, job.id);
  const complete = completeAttention.bind(null, job.id);
  const reschedule = rescheduleAttention.bind(null, job.id);
  const remove = deleteJob.bind(null, job.id);
  const attention = buildAttentionItems([job], new Date(), configuredTimeZone())[0];
  let confirmedCase: JobCase | null = null;
  if (job.jobCase) confirmedCase = parseJobCase(job.jobCase);
  const roleConfidence = confirmedCase?.confidence ?? (job.roleFamily ? 1 : 0);
  const resumeRoute = await buildResumeRoute(job.roleFamily, roleConfidence, resumes);
  const selectedFile = job.selectedResume ? await checkResumeFile(job.selectedResume.filePath) : null;
  const selectedResumeReady = Boolean(job.selectedResume?.active && selectedFile?.usable);
  const outreachConfigured = Boolean(process.env.OUTREACH_CONTEXT_PATH && process.env.OPENAI_API_KEY);
  // Naming the one unmet condition beats listing all four and leaving the reader to guess.
  const outreachBlockers = [
    confirmedCase ? null : "a confirmed JobCase. This job was entered manually, so analyze its source from Add job to get one.",
    job.recruiter?.email ? null : "a recruiter email. Add one under Edit job below.",
    selectedResumeReady ? null : `a usable resume. ${job.roleFamily ? resumeRoute.issue ?? "Choose one in Resume router above." : "This job has no confirmed role family yet, so nothing can be routed; set it under Edit job below."}`,
    outreachConfigured ? null : "local OPENAI_API_KEY and OUTREACH_CONTEXT_PATH configuration.",
  ].filter((blocker): blocker is string => blocker !== null);
  const outreachErrorMessage = outreachError === "configuration"
    ? "Outreach generation is not configured. Set OPENAI_API_KEY and OUTREACH_CONTEXT_PATH in the local environment, then restart the app."
    : outreachError === "failed"
      ? "Outreach generation failed. Check the private context file and AI configuration, then try again."
      : null;

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <Link className="text-sm font-medium text-emerald-700 underline" href="/jobs">← All jobs</Link>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Jobs</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{job.title}</h1>
          <p className="mt-2 text-slate-600">{job.client ?? "Client not set"} · {job.location ?? "Location not set"} · {job.roleFamily ? formatEnum(job.roleFamily) : "Role not set"}</p>
          {job.recruiter && (
            <p className="mt-1 text-sm text-slate-600">
              Recruiter: <Link className="font-medium text-emerald-700 underline" href={`/recruiters/${job.recruiter.id}`}>{job.recruiter.name}</Link>
            </p>
          )}
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

      {confirmedCase && (
        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" id="job-case">
          <form action={updateJobCase.bind(null, job.id)}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">Confirmed JobCase</h2>
                <p className="mt-1 text-sm text-slate-600">AI-extracted facts reviewed and confirmed by the user.</p>
              </div>
              <div className="flex items-center gap-3">
                {editingCase ? (
                  <>
                    <Link className="text-sm font-medium text-slate-600 underline" href={`/jobs/${job.id}#job-case`}>Cancel</Link>
                    <button className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800" type="submit">Save edits</button>
                  </>
                ) : (
                  <Link aria-label="Edit confirmed JobCase" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-500" href={`/jobs/${job.id}?edit=case#job-case`} title="Edit confirmed JobCase">✏️ Edit</Link>
                )}
              </div>
            </div>

            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              {([
                ["Rate", "rate", confirmedCase.rate, 200],
                ["Years required", "yearsRequired", confirmedCase.yearsRequired, 200],
                ["Visa", "visaRequirement", confirmedCase.visaRequirement, 500],
                ["Local", "localRequirement", confirmedCase.localRequirement, 500],
                ["Relocation", "relocationRequirement", confirmedCase.relocationRequirement, 500],
                ["Clearance", "clearanceRequirement", confirmedCase.clearanceRequirement, 500],
                ["Required skills", "requiredSkills", confirmedCase.requiredSkills.join(", "), 5000],
              ] as const).map(([label, name, value, maximum]) => (
                <div key={name}>
                  <dt className="font-medium text-slate-500">{label}</dt>
                  <dd className="mt-1 text-slate-900">
                    {editingCase
                      ? <input className={cellInputClass} defaultValue={value ?? ""} maxLength={maximum} name={name} />
                      : value || "Unknown"}
                  </dd>
                </div>
              ))}
              <div>
                <dt className="font-medium text-slate-500">Analysis confidence</dt>
                <dd className="mt-1 text-slate-900">{Math.round(confirmedCase.confidence * 100)}%</dd>
              </div>
            </dl>

            {editingCase && <p className="mt-5 text-xs leading-5 text-slate-500">Title, client, location, role family and recruiter are edited under Edit job. Analysis confidence and the model&apos;s evidence stay as reported. Saving records a correction and sends any unsent outreach draft back for review.</p>}
          </form>
        </section>
      )}

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" id="resume-router">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h2 className="text-xl font-semibold text-slate-950">Resume router</h2><p className="mt-1 text-sm text-slate-600">Deterministic registry selection; no AI-generated file paths.</p></div>
          <Link className="text-sm font-medium text-emerald-700 underline" href={`/resumes?from=/jobs/${job.id}`}>Manage registry</Link>
        </div>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-3">
          <div><dt className="font-medium text-slate-500">Confirmed role</dt><dd className="mt-1 font-semibold text-slate-900">{job.roleFamily ? formatEnum(job.roleFamily) : "Not set"}</dd></div>
          <div><dt className="font-medium text-slate-500">Classification confidence</dt><dd className="mt-1 font-semibold text-slate-900">{Math.round(roleConfidence * 100)}%</dd></div>
          <div><dt className="font-medium text-slate-500">Routing status</dt><dd className={`mt-1 font-semibold ${selectedResumeReady ? "text-emerald-700" : "text-amber-800"}`}>{selectedResumeReady ? "Ready" : "Needs review"}</dd></div>
        </dl>

        {job.selectedResume ? (
          <div className={`mt-5 rounded-xl border p-4 ${selectedResumeReady ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
            <p className="font-semibold text-slate-950">Selected: {job.selectedResume.name} · {job.selectedResume.version}</p>
            <p className="mt-1 text-sm text-slate-700">{formatEnum(job.selectedResume.roleFamily)}</p>
            <p className={`mt-2 text-sm font-medium ${selectedResumeReady ? "text-emerald-800" : "text-red-800"}`}>{selectedResumeReady ? "Active file verified and eligible for a future draft." : job.selectedResume.active ? selectedFile?.issue : "Blocked because this resume is inactive."}</p>
          </div>
        ) : <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900">{resumeRoute.issue ?? "Choose a resume before continuing."}</p>}

        {resumeRoute.recommended && resumeRoute.recommended.id !== job.selectedResumeId && (
          <form action={selectResume.bind(null, job.id, resumeRoute.recommended.id)} className="mt-5">
            <button className="rounded-lg bg-emerald-700 px-4 py-2.5 font-medium text-white hover:bg-emerald-800" type="submit">Use recommended: {resumeRoute.recommended.name} · {resumeRoute.recommended.version}</button>
          </form>
        )}

        {/* Always reachable, so a resume can be swapped again later, not only while routing needs review. */}
        <details className="mt-6" open={resumeRoute.needsReview || !selectedResumeReady}>
          <summary className="cursor-pointer font-semibold text-slate-950">Change resume</summary>
          <div className="mt-3">
            {!job.roleFamily && <p className="mt-1 text-sm text-slate-600">No role family was confirmed for this job. Choosing a resume here sets the job to that resume&apos;s family and records the correction.</p>}
            {resumeRoute.candidates.length ? (
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {resumeRoute.candidates.map((resume) => (
                  <li className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-4 text-sm" key={resume.id}>
                    <div><p className="font-semibold text-slate-950">{resume.name} · {resume.version}</p><p className="mt-1 text-slate-600">{formatEnum(resume.roleFamily)}{resume.roleFamily === job.roleFamily ? ` · ${Math.round(roleConfidence * 100)}% role confidence` : " · Manual override"}</p></div>
                    {resume.id !== job.selectedResumeId && (
                      <form action={selectResume.bind(null, job.id, resume.id)}>
                        <button className="rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-700 hover:border-slate-500" title={resume.roleFamily === job.roleFamily ? "Attach this resume" : `Attach this resume and set the role family to ${formatEnum(resume.roleFamily)}`} type="submit">
                          {resume.roleFamily === job.roleFamily ? "Select" : `Select · set role ${formatEnum(resume.roleFamily)}`}
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-3 text-sm text-slate-600">No active, readable resume is available. Add one in the registry.</p>}
          </div>
        </details>
      </section>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" id="outreach-draft">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-semibold text-slate-950">Outreach email</h2><p className="mt-1 text-sm text-slate-600">Outlook draft creation is approval-gated; sending always remains manual.</p></div>{job.outreachDraft && <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">{formatEnum(job.outreachDraft.status)} · Outlook {formatEnum(job.outreachDraft.outlookState)}</span>}</div>
        {outreachErrorMessage && <p className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800" role="alert">{outreachErrorMessage}</p>}
        {job.outreachDraft ? (
          <Link className="mt-5 inline-flex rounded-lg bg-slate-950 px-4 py-2.5 font-medium text-white hover:bg-slate-800" href={`/jobs/${job.id}/outreach`}>Review outreach draft</Link>
        ) : confirmedCase && selectedResumeReady && job.recruiter?.email && outreachConfigured ? (
          <form action={generateOutreachDraft.bind(null, job.id)} className="mt-5"><GenerateOutreachButton /></form>
        ) : (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">The email writer is missing:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">{outreachBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500">Generation sends confirmed facts and the private approved context to the configured OpenAI API with response storage disabled.</p>
      </section>

      <section className="mt-8 scroll-mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-6" id="attention-actions">
        <h2 className="text-xl font-semibold text-slate-950">Follow-up actions</h2>
        {attention ? (
          <>
            <p className="mt-2 text-sm text-slate-700"><span className="font-medium">Why:</span> {attention.reason}</p>
            <p className="mt-1 text-sm text-slate-700"><span className="font-medium">Next:</span> {attention.nextAction}</p>
            <div className="mt-5 grid items-end gap-5 lg:grid-cols-[auto_minmax(0,1fr)]">
              <form action={complete}>
                <button className="rounded-lg bg-emerald-700 px-4 py-2.5 font-medium text-white hover:bg-emerald-800" type="submit">Complete item</button>
              </form>
              <form action={reschedule} className="grid items-end gap-3 sm:grid-cols-[minmax(160px,0.45fr)_minmax(220px,1fr)_auto]">
                <label className="text-sm font-medium text-slate-800">
                  New follow-up date <span aria-hidden="true" className="text-red-700">*</span>
                  <input className={inputClass} name="nextFollowUpAt" required type="date" />
                </label>
                <label className="text-sm font-medium text-slate-800">
                  Next action
                  <input className={inputClass} defaultValue={attention.nextAction} maxLength={500} name="nextAction" />
                </label>
                <button className="rounded-lg border border-slate-400 bg-white px-4 py-2.5 font-medium text-slate-800 hover:border-slate-600" type="submit">Reschedule</button>
              </form>
            </div>
          </>
        ) : <p className="mt-2 text-sm text-slate-700">Nothing needs attention now. Add a next action or follow-up date below when needed.</p>}
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
                roleFamily: job.roleFamily,
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
