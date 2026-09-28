import { Check, Clock, Copy, ExternalLink, FileText, Mail, OctagonX, PenLine, Reply, ShieldAlert, ShieldCheck, SlidersHorizontal, Users } from "lucide-react";
import { OpenInOutlookButton } from "@/components/open-in-outlook-button";
import type { JobSourceType } from "@/app/generated/prisma/enums";
import type { IntakePreview } from "@/services/intake-pipeline";
import {
  employmentTypes,
  formatEnum,
  jobSourceTypes,
  workArrangements,
} from "@/lib/job-values";
import type { RoleFamilyOption } from "@/services/role-family";
import type { JobCase } from "@/services/job-case";

const inputClass =
  "mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";

export function JobCaseReviewForm({
  jobCase,
  recruiterLinkedin,
  sourceMessageId,
  source,
  preview,
  resumes,
  roleFamilies,
  confirmAction,
  confirmAndDraftAction,
  duplicateAction,
  hasExactDuplicate,
  straightThrough,
  employerCopy,
  threads,
  threadRequired,
  canWrite,
}: {
  jobCase: JobCase;
  recruiterLinkedin: string | null;
  sourceMessageId: string | null;
  source: { sourceType: JobSourceType; originalSender: string | null; receivedAt: Date };
  preview: IntakePreview | null;
  resumes: Array<{ id: string; name: string; version: string; roleFamily: string }>;
  roleFamilies: RoleFamilyOption[];
  confirmAction: (formData: FormData) => void | Promise<void>;
  confirmAndDraftAction: (formData: FormData) => Promise<{ url: string | null; href?: string | null }>;
  duplicateAction: (formData: FormData) => void | Promise<void>;
  hasExactDuplicate: boolean;
  straightThrough: boolean;
  employerCopy: { address: string; defaultOn: boolean } | null;
  /** Null unless the mode replies into a thread; then one of these must be chosen. */
  threads: Array<{ id: string; subject: string; receivedDateTime: string }> | null;
  threadRequired: boolean;
  canWrite: boolean;
}) {
  return (
    <form action={confirmAction} className="space-y-4">
      {preview?.brake && (
        <p className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900" title={`No email was drafted: ${preview.brake}`}>
          <OctagonX aria-hidden="true" className="shrink-0" size={16} /><span className="sm:truncate">{preview.brake}</span>
        </p>
      )}

      {preview?.subject && preview.body && (
        <fieldset className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5">
          <legend className="flex items-center gap-2 px-2 text-base font-semibold text-slate-950">
            <Mail aria-hidden="true" size={17} />Email
            {preview.validation && (preview.validation.status === "PASS"
              ? <span aria-label="Validator: every statement is supported" role="img" title="Every statement is supported"><ShieldCheck aria-hidden="true" className="text-emerald-600" size={17} /></span>
              : <span aria-label="Validator: needs review before approval" role="img" title="Needs review before approval"><ShieldAlert aria-hidden="true" className="text-amber-600" size={17} /></span>)}
          </legend>
          {preview.validation && preview.validation.status !== "PASS" && preview.validation.issues.length > 0 && (
            <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
              {preview.validation.issues.map((issue, index) => <li key={`${issue.field}-${index}`}><span className="font-semibold">{formatEnum(issue.field)}</span> · {issue.message}</li>)}
            </ul>
          )}
          <label className="text-sm font-medium text-slate-800">To<input className={inputClass} defaultValue={preview.toAddress ?? ""} maxLength={320} name="draftToAddress" type="email" /></label>
          {threads && (
            <fieldset>
              <legend className="flex items-center gap-1.5 text-sm font-medium text-slate-800"><Reply aria-hidden="true" size={15} />Reply into</legend>
              {!threadRequired && (
                <label className="mt-2 flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <input defaultChecked name="replySourceMessageId" type="radio" value="" />
                  <span className="font-medium text-slate-950">New email</span>
                </label>
              )}
              {threads.length ? (
                <div className="mt-2 space-y-2">
                  {threads.map((message) => (
                    <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm" key={message.id}>
                      <input defaultChecked={message.id === sourceMessageId} name="replySourceMessageId" required={threadRequired} type="radio" value={message.id} />
                      <span className="min-w-0 truncate font-medium text-slate-950" title={message.subject}>{message.subject}</span>
                      <span className="ml-auto shrink-0 text-xs text-slate-500">{message.receivedDateTime.slice(5, 16).replace("T", " ")}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-amber-900" title="No recent Inbox message from this recruiter was found; pick the thread on the job page after confirming.">
                  <Reply aria-hidden="true" size={14} />No thread found
                </p>
              )}
            </fieldset>
          )}
          {employerCopy && (
            <label className="flex items-center gap-2 text-sm text-slate-800" title={`Copy ${employerCopy.address} on this email`}>
              <input defaultChecked={employerCopy.defaultOn} name="copyEmployer" type="checkbox" value="true" />
              <Users aria-hidden="true" className="text-slate-500" size={15} />Cc {employerCopy.address}
            </label>
          )}
          <label className="text-sm font-medium text-slate-800">Subject<input className={inputClass} defaultValue={preview.subject} maxLength={300} name="draftSubject" /></label>
          <label className="text-sm font-medium text-slate-800">
            Body
            <textarea className={`${inputClass} font-mono text-sm leading-6`} defaultValue={preview.body} maxLength={10_000} name="draftBody" rows={10} />
          </label>
        </fieldset>
      )}

      <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-800" title="Resume to attach">
        <FileText aria-label="Resume" className="shrink-0 text-slate-500" size={17} />
        {resumes.length ? (
          <select className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" defaultValue={preview?.resumeId ?? ""} name="resumeId">
            <option value="">Auto (by role family)</option>
            {resumes.map((resume) => <option key={resume.id} value={resume.id}>{resume.name} · {resume.version} · {formatEnum(resume.roleFamily)}</option>)}
          </select>
        ) : <span className="text-slate-500">No active resume</span>}
      </label>

      <details className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-slate-700 [&::-webkit-details-marker]:hidden" title="Source, facts, recruiter and hard requirements">
          <SlidersHorizontal aria-hidden="true" size={16} />Details
        </summary>
        <div className="mt-5 space-y-8">
      <fieldset className="grid gap-5 md:grid-cols-2">
        <legend className="px-2 text-base font-semibold text-slate-950">Source</legend>
        <label className="text-sm font-medium text-slate-800">
          Source type
          <select className={inputClass} defaultValue={source.sourceType} name="sourceType">
            {jobSourceTypes.map((value) => <option key={value} value={value}>{formatEnum(value)}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-800">
          Received at
          <input className={inputClass} defaultValue={source.receivedAt.toISOString().slice(0, 16)} name="receivedAt" type="datetime-local" />
        </label>
        <label className="text-sm font-medium text-slate-800 md:col-span-2">
          Who sent this to you
          <input className={inputClass} defaultValue={source.originalSender ?? ""} maxLength={500} name="originalSender" />
        </label>
      </fieldset>

      <fieldset className="grid gap-5 md:grid-cols-2">
        <legend className="px-2 text-base font-semibold text-slate-950">Confirmed opportunity facts</legend>
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
            {roleFamilies.map((family) => <option key={family.code} value={family.code}>{family.label}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-800 md:col-span-2">
          Required skills, one per line
          <textarea className={inputClass} defaultValue={jobCase.requiredSkills.join("\n")} maxLength={5000} name="requiredSkills" rows={5} />
        </label>
      </fieldset>

      <fieldset className="grid gap-5 md:grid-cols-2">
        <legend className="px-2 text-base font-semibold text-slate-950">Recruiter</legend>
        <label className="text-sm font-medium text-slate-800">Name<input className={inputClass} defaultValue={jobCase.recruiterName ?? ""} maxLength={200} name="recruiterName" /></label>
        <label className="text-sm font-medium text-slate-800">Email<input className={inputClass} defaultValue={jobCase.recruiterEmail ?? ""} maxLength={320} name="recruiterEmail" type="email" /></label>
        <label className="text-sm font-medium text-slate-800">Phone<input className={inputClass} defaultValue={jobCase.recruiterPhone ?? ""} maxLength={80} name="recruiterPhone" type="tel" /></label>
        <label className="text-sm font-medium text-slate-800">LinkedIn or profile URL<input className={inputClass} defaultValue={recruiterLinkedin ?? ""} maxLength={500} name="recruiterLinkedin" placeholder="https://www.linkedin.com/in/…" type="url" /></label>
      </fieldset>

      <fieldset className="grid gap-5 md:grid-cols-2">
        <legend className="px-2 text-base font-semibold text-slate-950">Hard requirements</legend>
        <label className="text-sm font-medium text-slate-800">Visa / work authorization<input className={inputClass} defaultValue={jobCase.visaRequirement ?? ""} maxLength={500} name="visaRequirement" /></label>
        <label className="text-sm font-medium text-slate-800">Local candidate<input className={inputClass} defaultValue={jobCase.localRequirement ?? ""} maxLength={500} name="localRequirement" /></label>
        <label className="text-sm font-medium text-slate-800">Relocation<input className={inputClass} defaultValue={jobCase.relocationRequirement ?? ""} maxLength={500} name="relocationRequirement" /></label>
        <label className="text-sm font-medium text-slate-800">Clearance<input className={inputClass} defaultValue={jobCase.clearanceRequirement ?? ""} maxLength={500} name="clearanceRequirement" /></label>
      </fieldset>
        </div>
      </details>

      <div className="flex flex-wrap gap-3">
        {straightThrough && (
          <>
            <OpenInOutlookButton action={confirmAndDraftAction} icon={<ExternalLink aria-hidden="true" size={16} />} title="Confirm and open the Outlook draft">Outlook</OpenInOutlookButton>
            <OpenInOutlookButton action={confirmAndDraftAction} icon={<Clock aria-hidden="true" size={16} />} open={false} title="Confirm and build the Outlook draft for later" tone="secondary">Later</OpenInOutlookButton>
          </>
        )}
        {(() => {
          const [label, tip, Icon] = preview?.subject
            ? ["Confirm", "Confirm and create the job with this draft", Check]
            : canWrite ? ["Write", "Confirm and write the email", PenLine] : ["Confirm", "Confirm and create the opportunity", Check];
          return (
            <button aria-label={tip} className={`flex items-center gap-2 rounded-lg px-5 py-3 font-medium ${straightThrough
              ? "border border-slate-400 bg-white text-slate-800 hover:border-slate-600"
              : "bg-emerald-700 text-white hover:bg-emerald-800"}`} title={tip} type="submit">
              <Icon aria-hidden="true" size={16} />{label}
            </button>
          );
        })()}
        {/* A second vendor on one role is a normal channel; only the same JD text twice is a duplicate. */}
        {hasExactDuplicate && (
          <button aria-label="Same posting again: create it and mark it a duplicate" className="flex items-center gap-2 rounded-lg border border-amber-400 bg-amber-50 px-5 py-3 font-medium text-amber-950 hover:border-amber-600" formAction={duplicateAction} title="Same posting again: create it and mark it a duplicate" type="submit">
            <Copy aria-hidden="true" size={16} />Duplicate
          </button>
        )}
      </div>
    </form>
  );
}
