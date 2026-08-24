import type { JobSourceType, RoleFamily } from "@/app/generated/prisma/enums";
import type { IntakePreview } from "@/services/intake-pipeline";
import {
  employmentTypes,
  formatEnum,
  jobSourceTypes,
  roleFamilies,
  workArrangements,
} from "@/lib/job-values";
import type { JobCase } from "@/services/job-case";

const inputClass =
  "mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";

export function JobCaseReviewForm({
  jobCase,
  source,
  preview,
  resumes,
  confirmAction,
  duplicateAction,
  hasExactDuplicate,
}: {
  jobCase: JobCase;
  source: { sourceType: JobSourceType; originalSender: string | null; receivedAt: Date };
  preview: IntakePreview | null;
  resumes: Array<{ id: string; name: string; version: string; roleFamily: RoleFamily }>;
  confirmAction: (formData: FormData) => void | Promise<void>;
  duplicateAction: (formData: FormData) => void | Promise<void>;
  hasExactDuplicate: boolean;
}) {
  return (
    <form action={confirmAction} className="space-y-8">
      <fieldset className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-6 md:grid-cols-2">
        <legend className="px-2 text-lg font-semibold text-slate-950">Source</legend>
        <p className="text-sm text-slate-600 md:col-span-2">Detected from the pasted text. Source type and sender decide which recipient the outreach validator will accept, so correct them here if the detection missed.</p>
        <label className="text-sm font-medium text-slate-800">
          Source type
          <select className={inputClass} defaultValue={source.sourceType} name="sourceType">
            {jobSourceTypes.map((value) => <option key={value} value={value}>{formatEnum(value)}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-800">
          Received at (UTC)
          <input className={inputClass} defaultValue={source.receivedAt.toISOString().slice(0, 16)} name="receivedAt" type="datetime-local" />
        </label>
        <label className="text-sm font-medium text-slate-800 md:col-span-2">
          Who sent this to you
          <input className={inputClass} defaultValue={source.originalSender ?? ""} maxLength={500} name="originalSender" placeholder="Leave blank when unknown" />
        </label>
      </fieldset>

      <fieldset className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-6 md:grid-cols-2">
        <legend className="px-2 text-lg font-semibold text-slate-950">Confirmed opportunity facts</legend>
        <label className="text-sm font-medium text-slate-800">
          Job title <span aria-hidden="true" className="text-red-700">*</span>
          <input className={inputClass} defaultValue={jobCase.title ?? ""} maxLength={200} name="title" required />
        </label>
        <label className="text-sm font-medium text-slate-800">Client<input className={inputClass} defaultValue={jobCase.client ?? ""} maxLength={200} name="client" /></label>
        <label className="text-sm font-medium text-slate-800">Vendor<input className={inputClass} defaultValue={jobCase.vendor ?? ""} maxLength={200} name="vendor" /></label>
        <label className="text-sm font-medium text-slate-800">Location<input className={inputClass} defaultValue={jobCase.location ?? ""} maxLength={200} name="location" /></label>
        <label className="text-sm font-medium text-slate-800">
          Work arrangement
          <select className={inputClass} defaultValue={jobCase.workArrangement} name="workArrangement">
            {workArrangements.map((value) => <option key={value} value={value}>{formatEnum(value)}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-800">
          Employment type
          <select className={inputClass} defaultValue={jobCase.employmentType} name="employmentType">
            {employmentTypes.map((value) => <option key={value} value={value}>{formatEnum(value)}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-800">Rate<input className={inputClass} defaultValue={jobCase.rate ?? ""} maxLength={200} name="rate" /></label>
        <label className="text-sm font-medium text-slate-800">Years required<input className={inputClass} defaultValue={jobCase.yearsRequired ?? ""} maxLength={200} name="yearsRequired" /></label>
        <label className="text-sm font-medium text-slate-800">
          Role family
          <select className={inputClass} defaultValue={jobCase.roleFamily ?? ""} name="roleFamily">
            <option value="">Unknown</option>
            {roleFamilies.map((value) => <option key={value} value={value}>{formatEnum(value)}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-800 md:col-span-2">
          Required skills, one per line
          <textarea className={inputClass} defaultValue={jobCase.requiredSkills.join("\n")} maxLength={5000} name="requiredSkills" rows={5} />
        </label>
      </fieldset>

      <fieldset className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-6 md:grid-cols-2">
        <legend className="px-2 text-lg font-semibold text-slate-950">Recruiter</legend>
        <label className="text-sm font-medium text-slate-800">Name<input className={inputClass} defaultValue={jobCase.recruiterName ?? ""} maxLength={200} name="recruiterName" /></label>
        <label className="text-sm font-medium text-slate-800">Email<input className={inputClass} defaultValue={jobCase.recruiterEmail ?? ""} maxLength={320} name="recruiterEmail" type="email" /></label>
        <label className="text-sm font-medium text-slate-800">Phone<input className={inputClass} defaultValue={jobCase.recruiterPhone ?? ""} maxLength={80} name="recruiterPhone" type="tel" /></label>
      </fieldset>

      <fieldset className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-6 md:grid-cols-2">
        <legend className="px-2 text-lg font-semibold text-slate-950">Hard requirements</legend>
        <label className="text-sm font-medium text-slate-800">Visa / work authorization<input className={inputClass} defaultValue={jobCase.visaRequirement ?? ""} maxLength={500} name="visaRequirement" /></label>
        <label className="text-sm font-medium text-slate-800">Local candidate<input className={inputClass} defaultValue={jobCase.localRequirement ?? ""} maxLength={500} name="localRequirement" /></label>
        <label className="text-sm font-medium text-slate-800">Relocation<input className={inputClass} defaultValue={jobCase.relocationRequirement ?? ""} maxLength={500} name="relocationRequirement" /></label>
        <label className="text-sm font-medium text-slate-800">Clearance<input className={inputClass} defaultValue={jobCase.clearanceRequirement ?? ""} maxLength={500} name="clearanceRequirement" /></label>
      </fieldset>

      <fieldset className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-6">
        <legend className="px-2 text-lg font-semibold text-slate-950">Resume</legend>
        {resumes.length ? (
          <label className="text-sm font-medium text-slate-800 md:col-span-2">
            Attachment
            <select className={inputClass} defaultValue={preview?.resumeId ?? ""} name="resumeId">
              <option value="">Decide automatically from the confirmed role family</option>
              {resumes.map((resume) => <option key={resume.id} value={resume.id}>{resume.name} · {resume.version} · {formatEnum(resume.roleFamily)}</option>)}
            </select>
          </label>
        ) : <p className="text-sm text-slate-600">No active resume is registered yet.</p>}
      </fieldset>

      {preview?.brake && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900">
          No email was drafted: {preview.brake}
        </p>
      )}

      {preview?.subject && preview.body && (
        <fieldset className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-6">
          <legend className="px-2 text-lg font-semibold text-slate-950">Outreach email</legend>
          {preview.validation && (
            <div className={`rounded-xl border p-4 text-sm md:col-span-2 ${preview.validation.status === "PASS" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
              <p className="font-semibold">Validator: {preview.validation.status === "PASS" ? "Every statement is supported" : "Needs review before approval"}</p>
              {preview.validation.issues.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {preview.validation.issues.map((issue, index) => <li key={`${issue.field}-${index}`}>{formatEnum(issue.field)}: {issue.message}</li>)}
                </ul>
              )}
            </div>
          )}
          <label className="text-sm font-medium text-slate-800">To<input className={inputClass} defaultValue={preview.toAddress ?? ""} maxLength={320} name="draftToAddress" type="email" /></label>
          <label className="text-sm font-medium text-slate-800">Subject<input className={inputClass} defaultValue={preview.subject} maxLength={300} name="draftSubject" /></label>
          <label className="text-sm font-medium text-slate-800 md:col-span-2">
            Body
            <textarea className={`${inputClass} font-mono text-sm leading-6`} defaultValue={preview.body} maxLength={10_000} name="draftBody" rows={16} />
            <span className="mt-1 block text-xs font-normal text-slate-500">Wrap a screening label in ** ** to bold it in Outlook. Editing here sends the email back for revalidation instead of approving it.</span>
          </label>
        </fieldset>
      )}

      <div className="flex flex-wrap gap-3">
        <button className="rounded-lg bg-emerald-700 px-5 py-3 font-medium text-white hover:bg-emerald-800" type="submit">
          {preview?.subject ? "Confirm and create job with draft" : "Confirm and create opportunity"}
        </button>
        {/* A second vendor on one role is a normal channel; only the same JD text twice is a duplicate. */}
        {hasExactDuplicate && (
          <button className="rounded-lg border border-amber-400 bg-amber-50 px-5 py-3 font-medium text-amber-950 hover:border-amber-600" formAction={duplicateAction} type="submit">
            Same posting again — create and mark duplicate
          </button>
        )}
      </div>
    </form>
  );
}
