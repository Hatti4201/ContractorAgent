import Link from "next/link";
import { notFound } from "next/navigation";
import { approveOutreachDraft, generateOutreachDraft, saveOutreachDraft } from "@/app/(protected)/jobs/[id]/outreach/actions";
import { formatDateTime, formatEnum } from "@/lib/job-values";
import { getPrisma } from "@/lib/prisma";
import { loadOutreachContext, outreachContextFingerprint } from "@/services/outreach-context";
import { parseOutreachValidation } from "@/services/outreach-agent";
import { checkResumeFile } from "@/services/resume-router";

const inputClass = "mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";

export default async function OutreachDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const draft = await getPrisma().outreachDraft.findUnique({
    where: { opportunityId: id },
    include: { opportunity: true, attachmentResume: true },
  });
  if (!draft) notFound();
  const validation = parseOutreachValidation(draft.validation);
  const file = await checkResumeFile(draft.attachmentResume.filePath);
  const attachmentReady = draft.attachmentResume.active && file.usable && draft.attachmentResume.roleFamily === draft.opportunity.roleFamily;
  let contextReady = false;
  try {
    contextReady = outreachContextFingerprint(await loadOutreachContext()) === draft.contextFingerprint;
  } catch {}
  const ready = validation.status === "PASS" && attachmentReady && contextReady && draft.status !== "NEEDS_REVIEW";
  const effectiveApproved = draft.status === "APPROVED" && ready;
  const save = saveOutreachDraft.bind(null, id);
  const regenerate = generateOutreachDraft.bind(null, id);
  const approve = approveOutreachDraft.bind(null, id);

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <Link className="text-sm font-medium text-emerald-700 underline" href={`/jobs/${id}`}>← Back to job</Link>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Phase 6 · Review only</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Outreach email draft</h1><p className="mt-2 text-slate-600">No Outlook draft is created and nothing is sent in this phase.</p></div>
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${effectiveApproved ? "bg-emerald-50 text-emerald-800" : ready ? "bg-slate-100 text-slate-700" : "bg-amber-50 text-amber-900"}`}>{effectiveApproved ? "Approved" : ready ? "Ready for approval" : "Needs review"}</span>
      </div>

      <section className="mt-8 grid gap-4 rounded-2xl border border-slate-200 bg-white p-6 text-sm shadow-sm sm:grid-cols-4">
        <div><p className="font-medium text-slate-500">Mode</p><p className="mt-1 font-semibold text-slate-950">{formatEnum(draft.mode)}</p></div>
        <div><p className="font-medium text-slate-500">Revision</p><p className="mt-1 font-semibold text-slate-950">{draft.revision}</p></div>
        <div><p className="font-medium text-slate-500">Validated</p><p className="mt-1 font-semibold text-slate-950">{formatDateTime(draft.updatedAt)} UTC</p></div>
        <div><p className="font-medium text-slate-500">Attachment</p><p className="mt-1 font-semibold text-slate-950">{draft.attachmentResume.name} · {draft.attachmentResume.version}</p></div>
      </section>

      <section className={`mt-6 rounded-2xl border p-5 ${ready ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
        <h2 className="font-semibold text-slate-950">Validator</h2>
        {validation.issues.length ? <ul className="mt-3 space-y-2 text-sm text-slate-800">{validation.issues.map((issue, index) => <li key={`${issue.field}-${index}`}><span className="font-semibold">{formatEnum(issue.severity)} · {formatEnum(issue.field)}:</span> {issue.message}</li>)}</ul> : <p className="mt-2 text-sm text-emerald-900">Recipient, approved facts, source mode, and attachment checks passed.</p>}
        {!attachmentReady && <p className="mt-2 text-sm font-medium text-red-800">Attachment is inactive, missing, unreadable, or no longer matches the Role Family.</p>}
        {!contextReady && <p className="mt-2 text-sm font-medium text-red-800">Private candidate/outreach context changed or is unavailable; validate again before approval.</p>}
      </section>

      <form action={save} className="mt-8 space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <label className="block text-sm font-medium text-slate-800">To <span aria-hidden="true" className="text-red-700">*</span><input className={inputClass} defaultValue={draft.toAddress} maxLength={320} name="toAddress" required type="email" /></label>
        <label className="block text-sm font-medium text-slate-800">Subject <span aria-hidden="true" className="text-red-700">*</span><input className={inputClass} defaultValue={draft.subject} maxLength={300} name="subject" required /></label>
        <label className="block text-sm font-medium text-slate-800">Body <span aria-hidden="true" className="text-red-700">*</span><textarea className={`${inputClass} font-mono text-sm leading-6`} defaultValue={draft.body} maxLength={10_000} name="body" required rows={18} /></label>
        <button className="rounded-lg bg-slate-950 px-5 py-3 font-medium text-white hover:bg-slate-800" type="submit">Save and validate</button>
      </form>

      <div className="mt-6 flex flex-wrap gap-3">
        <form action={regenerate}><button className="rounded-lg border border-slate-400 bg-white px-4 py-2.5 font-medium text-slate-800 hover:border-slate-600" type="submit">Regenerate</button></form>
        <form action={approve}><button className="rounded-lg bg-emerald-700 px-4 py-2.5 font-medium text-white hover:bg-emerald-800" type="submit">Approve current draft</button></form>
      </div>
      <p className="mt-4 text-xs text-slate-500">Generate, save, and approve send the confirmed facts and private approved context to the configured OpenAI API with response storage disabled.</p>
    </div>
  );
}
