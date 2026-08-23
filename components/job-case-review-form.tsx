import type { JobSourceType } from "@/app/generated/prisma/enums";
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
  confirmAction,
  duplicateAction,
  hasDuplicates,
}: {
  jobCase: JobCase;
  source: { sourceType: JobSourceType; originalSender: string | null; receivedAt: Date };
  confirmAction: (formData: FormData) => void | Promise<void>;
  duplicateAction: (formData: FormData) => void | Promise<void>;
  hasDuplicates: boolean;
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

      <div className="flex flex-wrap gap-3">
        <button className="rounded-lg bg-emerald-700 px-5 py-3 font-medium text-white hover:bg-emerald-800" type="submit">Confirm and create opportunity</button>
        {hasDuplicates && (
          <button className="rounded-lg border border-amber-400 bg-amber-50 px-5 py-3 font-medium text-amber-950 hover:border-amber-600" formAction={duplicateAction} type="submit">
            Create and mark duplicate
          </button>
        )}
      </div>
    </form>
  );
}
