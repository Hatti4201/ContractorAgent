import {
  applicationStages,
  employmentTypes,
  formatEnum,
  workArrangements,
} from "@/lib/job-values";

type JobFormValues = {
  title?: string;
  client?: string | null;
  location?: string | null;
  employmentType?: string;
  workArrangement?: string;
  rawJd?: string | null;
  vendorName?: string | null;
  recruiterName?: string | null;
  recruiterEmail?: string | null;
  recruiterPhone?: string | null;
  currentStage?: string;
  waitingOn?: string | null;
  nextAction?: string | null;
  nextFollowUpAt?: string;
};

const inputClass =
  "mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";

export function JobForm({
  action,
  initial = {},
  submitLabel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  initial?: JobFormValues;
  submitLabel: string;
}) {
  return (
    <form action={action} className="space-y-8">
      <fieldset className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-6 md:grid-cols-2">
        <legend className="px-2 text-lg font-semibold text-slate-950">Opportunity</legend>
        <label className="text-sm font-medium text-slate-800">
          Job title <span aria-hidden="true" className="text-red-700">*</span>
          <input className={inputClass} defaultValue={initial.title ?? ""} maxLength={200} name="title" required />
        </label>
        <label className="text-sm font-medium text-slate-800">
          Client
          <input className={inputClass} defaultValue={initial.client ?? ""} maxLength={200} name="client" />
        </label>
        <label className="text-sm font-medium text-slate-800">
          Location
          <input className={inputClass} defaultValue={initial.location ?? ""} maxLength={200} name="location" />
        </label>
        <label className="text-sm font-medium text-slate-800">
          Work arrangement
          <select className={inputClass} defaultValue={initial.workArrangement ?? "UNKNOWN"} name="workArrangement">
            {workArrangements.map((value) => <option key={value} value={value}>{formatEnum(value)}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-800 md:col-span-2">
          Employment type
          <select className={inputClass} defaultValue={initial.employmentType ?? "UNKNOWN"} name="employmentType">
            {employmentTypes.map((value) => <option key={value} value={value}>{formatEnum(value)}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-800 md:col-span-2">
          Job description
          <textarea className={inputClass} defaultValue={initial.rawJd ?? ""} maxLength={50000} name="rawJd" rows={8} />
        </label>
      </fieldset>

      <fieldset className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-6 md:grid-cols-2">
        <legend className="px-2 text-lg font-semibold text-slate-950">Recruiter and vendor</legend>
        <label className="text-sm font-medium text-slate-800">
          Vendor
          <input className={inputClass} defaultValue={initial.vendorName ?? ""} maxLength={200} name="vendorName" />
        </label>
        <label className="text-sm font-medium text-slate-800">
          Recruiter name
          <input className={inputClass} defaultValue={initial.recruiterName ?? ""} maxLength={200} name="recruiterName" />
        </label>
        <label className="text-sm font-medium text-slate-800">
          Recruiter email
          <input className={inputClass} defaultValue={initial.recruiterEmail ?? ""} maxLength={320} name="recruiterEmail" type="email" />
        </label>
        <label className="text-sm font-medium text-slate-800">
          Recruiter phone
          <input className={inputClass} defaultValue={initial.recruiterPhone ?? ""} maxLength={80} name="recruiterPhone" type="tel" />
        </label>
      </fieldset>

      <fieldset className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-6 md:grid-cols-2">
        <legend className="px-2 text-lg font-semibold text-slate-950">Application track</legend>
        <label className="text-sm font-medium text-slate-800">
          Current stage
          <select className={inputClass} defaultValue={initial.currentStage ?? "DISCOVERED"} name="currentStage">
            {applicationStages.map((value) => <option key={value} value={value}>{formatEnum(value)}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-800">
          Next follow-up
          <input className={inputClass} defaultValue={initial.nextFollowUpAt ?? ""} name="nextFollowUpAt" type="date" />
        </label>
        <label className="text-sm font-medium text-slate-800">
          Waiting on
          <input className={inputClass} defaultValue={initial.waitingOn ?? ""} maxLength={500} name="waitingOn" />
        </label>
        <label className="text-sm font-medium text-slate-800">
          Next action
          <input className={inputClass} defaultValue={initial.nextAction ?? ""} maxLength={500} name="nextAction" />
        </label>
      </fieldset>

      <button className="rounded-lg bg-slate-950 px-5 py-3 font-medium text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2" type="submit">
        {submitLabel}
      </button>
    </form>
  );
}
