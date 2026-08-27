import Link from "next/link";
import { notFound } from "next/navigation";
import { approveOutreachDraft, generateOutreachDraft, saveOutreachDraft, setOutreachCopy } from "@/app/(protected)/jobs/[id]/outreach/actions";
import { confirmOutlookSent, createOutlookDraft, selectOutlookReplySource } from "@/app/(protected)/jobs/[id]/outlook/actions";
import { OutlookDraftState, OutreachMode, TaskKind, TaskStatus } from "@/app/generated/prisma/enums";
import { formatDateTime, formatEnum } from "@/lib/job-values";
import { getPrisma } from "@/lib/prisma";
import { employerCcSetting } from "@/services/employer";
import { outreachBodyHtml } from "@/services/outreach-markup";
import { outlookAccessToken, outlookConnected } from "@/services/outlook-auth";
import { loadOutreachContext, outreachContextFingerprint } from "@/services/outreach-context";
import { parseOutreachValidation } from "@/services/outreach-agent";
import { listOutlookSourceMessages, replyModes } from "@/services/outlook-graph";
import { checkResumeFile } from "@/services/resume-router";

const inputClass = "mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";
const lockedOutlookStates = new Set<OutlookDraftState>([OutlookDraftState.CREATING, OutlookDraftState.CREATED, OutlookDraftState.SENT]);

function safeOutlookLink(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["outlook.office.com", "outlook.office365.com", "outlook.live.com"].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)) ? value : null;
  } catch { return null; }
}

export default async function OutreachDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const draft = await getPrisma().outreachDraft.findUnique({
    where: { opportunityId: id },
    include: { opportunity: { include: { recruiter: true } }, attachmentResume: true },
  });
  if (!draft) {
    // The first generation writes this row only after two model calls, and the action redirects here
    // at once. A missing draft with work still running is a wait, not a page that does not exist.
    const writing = await getPrisma().task.count({
      where: { subjectId: id, kind: TaskKind.OUTREACH_REGENERATE, status: TaskStatus.RUNNING },
    });
    if (!writing) notFound();
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Outreach</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Writing your email</h1>
        <p className="mt-3 text-slate-600">The draft is being written and validated in the background. This page fills in when it finishes; the corner tray tracks progress and you can leave.</p>
        <Link className="mt-6 inline-block font-medium text-emerald-700 underline" href={`/jobs/${id}`}>Back to the job</Link>
      </div>
    );
  }
  const employerCopy = employerCcSetting();
  const validation = parseOutreachValidation(draft.validation);
  const file = await checkResumeFile(draft.attachmentResume.filePath);
  const attachmentReady = draft.attachmentResume.active && file.usable && draft.attachmentResume.roleFamily === draft.opportunity.roleFamily;
  let contextReady = false;
  try {
    contextReady = outreachContextFingerprint(await loadOutreachContext()) === draft.contextFingerprint;
  } catch {}
  const checksReady = attachmentReady && contextReady;
  const ready = validation.status === "PASS" && checksReady && draft.status !== "NEEDS_REVIEW";
  const effectiveApproved = draft.status === "APPROVED" && checksReady;
  const connected = await outlookConnected();
  const replyRequired = replyModes.has(draft.mode);
  const locked = lockedOutlookStates.has(draft.outlookState) || Boolean(draft.outlookMessageId);
  // A flagged message still has to be checkable, otherwise NEEDS_REVIEW is a dead end.
  const sentCheckAvailable = Boolean(draft.outlookMessageId) && (draft.outlookState === OutlookDraftState.CREATED || draft.outlookState === OutlookDraftState.NEEDS_REVIEW);
  let sourceCandidates: Awaited<ReturnType<typeof listOutlookSourceMessages>> = [];
  let sourceLookupFailed = false;
  if (connected && effectiveApproved && replyRequired && !draft.replySourceMessageId && !locked && draft.opportunity.recruiter?.email) {
    try { sourceCandidates = await listOutlookSourceMessages(draft.opportunity.recruiter.email, { accessToken: await outlookAccessToken() }); } catch { sourceLookupFailed = true; }
  }
  const outlookLink = safeOutlookLink(draft.outlookWebLink);
  const save = saveOutreachDraft.bind(null, id);
  const regenerate = generateOutreachDraft.bind(null, id);
  const approve = approveOutreachDraft.bind(null, id);
  const selectReplySource = selectOutlookReplySource.bind(null, id);
  const createExternalDraft = createOutlookDraft.bind(null, id);
  const confirmSent = confirmOutlookSent.bind(null, id);

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <Link className="text-sm font-medium text-emerald-700 underline" href={`/jobs/${id}`}>← Back to job</Link>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Outreach</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Outreach email draft</h1><p className="mt-2 text-slate-600">Approval is required before Outlook draft creation; nothing is ever sent automatically.</p></div>
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${effectiveApproved ? "bg-emerald-50 text-emerald-800" : ready ? "bg-slate-100 text-slate-700" : "bg-amber-50 text-amber-900"}`}>{effectiveApproved ? "Approved" : ready ? "Ready for approval" : "Needs review"}</span>
      </div>

      <section className="mt-8 grid gap-4 rounded-2xl border border-slate-200 bg-white p-6 text-sm shadow-sm sm:grid-cols-4">
        <div><p className="font-medium text-slate-500">Mode</p><p className="mt-1 font-semibold text-slate-950">{formatEnum(draft.mode)}</p></div>
        <div><p className="font-medium text-slate-500">Revision</p><p className="mt-1 font-semibold text-slate-950">{draft.revision}</p></div>
        <div><p className="font-medium text-slate-500">Validated</p><p className="mt-1 font-semibold text-slate-950">{formatDateTime(draft.updatedAt)} UTC</p></div>
        <div><p className="font-medium text-slate-500">Attachment</p><p className="mt-1 font-semibold text-slate-950">{draft.attachmentResume.name} · {draft.attachmentResume.version}</p></div>
      </section>

      <section className={`mt-6 rounded-2xl border p-5 ${ready ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
        <h2 className="font-semibold text-slate-950">Validator (reference)</h2>
        {validation.issues.length ? <ul className="mt-3 space-y-2 text-sm text-slate-800">{validation.issues.map((issue, index) => <li key={`${issue.field}-${index}`}><span className="font-semibold">{formatEnum(issue.severity)} · {formatEnum(issue.field)}:</span> {issue.message}</li>)}</ul> : <p className="mt-2 text-sm text-emerald-900">Recipient, approved facts, source mode, and attachment checks passed.</p>}
        {!attachmentReady && <p className="mt-2 text-sm font-medium text-red-800">Attachment is inactive, missing, unreadable, or no longer matches the Role Family.</p>}
        {!contextReady && <p className="mt-2 text-sm font-medium text-red-800">Private candidate/outreach context changed or is unavailable; validate again before approval.</p>}
        <p className="mt-3 text-xs text-slate-600">Validation findings are advisory. You make the final decision; an explicit override can continue to Outlook draft creation after reviewing the warnings.</p>
      </section>

      <form action={save} className="mt-8 space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        {!locked && <label className="block text-sm font-medium text-slate-800">Mode <span aria-hidden="true" className="text-red-700">*</span><select className={inputClass} defaultValue={draft.mode} name="mode" required>{Object.values(OutreachMode).map((mode) => <option key={mode} value={mode}>{formatEnum(mode)}</option>)}</select><span className="mt-1 block text-xs font-normal text-slate-500">Changing mode clears any previously selected Outlook reply message and requires revalidation.</span></label>}
        <label className="block text-sm font-medium text-slate-800">To <span aria-hidden="true" className="text-red-700">*</span><input className={inputClass} defaultValue={draft.toAddress} maxLength={320} name="toAddress" readOnly={locked} required type="email" /></label>
        <label className="block text-sm font-medium text-slate-800">Subject <span aria-hidden="true" className="text-red-700">*</span><input className={inputClass} defaultValue={draft.subject} maxLength={300} name="subject" readOnly={locked} required /></label>
        <label className="block text-sm font-medium text-slate-800">Body <span aria-hidden="true" className="text-red-700">*</span><textarea className={`${inputClass} font-mono text-sm leading-6`} defaultValue={draft.body} maxLength={10_000} name="body" readOnly={locked} required rows={18} /></label>
        {!locked && <button className="rounded-lg bg-slate-950 px-5 py-3 font-medium text-white hover:bg-slate-800" type="submit">Save and validate</button>}
        {locked && <p className="text-sm font-medium text-slate-600">Content is locked because an Outlook draft now represents this approved revision.</p>}
      </form>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-800">Copy my employer</h2>
        <p className="mt-1 text-xs text-slate-500">Suggested for a C2C engagement. The address comes from your private configuration, never from the model, and this draft is currently {draft.ccAddress ? `copying ${draft.ccAddress}` : "copying nobody"}.</p>
        {employerCopy.issue && <p className="mt-2 text-xs font-medium text-red-800">{employerCopy.issue}</p>}
        {!employerCopy.address && !employerCopy.issue && <p className="mt-2 text-xs font-medium text-amber-800">No employer address is configured, so no copy can be added.</p>}
        {!locked && employerCopy.address && (
          <form action={setOutreachCopy.bind(null, draft.opportunityId)} className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
              <input className="h-4 w-4" defaultChecked={Boolean(draft.ccAddress)} name="copyEmployer" type="checkbox" />
              Copy {employerCopy.address} on this email
            </label>
            <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-500" type="submit">Apply</button>
          </form>
        )}
        {locked && <p className="mt-2 text-xs text-slate-600">Locked: the Outlook draft already exists. Change the copy in Outlook itself.</p>}
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-800">Outlook preview</h2>
        <p className="mt-1 text-xs text-slate-500">Exactly what the Outlook draft will contain. Wrap a screening label in ** ** to bold it.</p>
        <div
          className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-900"
          // Built by outreachBodyHtml, which escapes the saved body before allowing bold.
          dangerouslySetInnerHTML={{ __html: outreachBodyHtml(draft.body) }}
        />
      </section>

      {!locked && <div className="mt-6 flex flex-wrap gap-3">
        <form action={regenerate}><button className="rounded-lg border border-slate-400 bg-white px-4 py-2.5 font-medium text-slate-800 hover:border-slate-600" type="submit">Regenerate</button></form>
        <form action={approve}>{validation.status === "PASS" ? <button className="rounded-lg bg-emerald-700 px-4 py-2.5 font-medium text-white hover:bg-emerald-800" type="submit">Approve current draft</button> : <button className="rounded-lg bg-amber-700 px-4 py-2.5 font-medium text-white hover:bg-amber-800" name="overrideWarnings" value="true" type="submit">Approve despite warnings</button>}</form>
      </div>}
      <p className="mt-4 text-xs text-slate-500">Generation, saving, and approval each send confirmed facts and private approved context to the configured OpenAI API with response storage disabled.</p>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="mt-1 text-xl font-semibold text-slate-950">Outlook draft</h2><p className="mt-1 text-sm text-slate-600">Only you can send from Outlook.</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">{formatEnum(draft.outlookState)}</span></div>
        {draft.outlookError && <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900">{draft.outlookError}</p>}
        {!connected && <p className="mt-5 text-sm text-slate-700"><Link className="font-medium text-emerald-700 underline" href="/outlook">Connect Outlook</Link> before creating an external draft.</p>}

        {connected && effectiveApproved && replyRequired && !draft.replySourceMessageId && !locked && (
          <div className="mt-5">
            <h3 className="font-semibold text-slate-950">Select the original Recruiter message</h3>
            <p className="mt-1 text-sm text-slate-600">Only messages from the confirmed Recruiter are offered; the application never guesses a thread.</p>
            {sourceCandidates.length ? <ul className="mt-4 space-y-3">{sourceCandidates.map((message) => <li className="rounded-xl border border-slate-200 p-4" key={message.id}><p className="font-medium text-slate-950">{message.subject}</p><p className="mt-1 text-xs text-slate-500">{formatDateTime(new Date(message.receivedDateTime))} UTC</p><form action={selectReplySource} className="mt-3"><input name="sourceMessageId" type="hidden" value={message.id} /><button className="rounded-lg border border-slate-400 bg-white px-3 py-2 text-sm font-medium" type="submit">Use this message</button></form></li>)}</ul> : <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{sourceLookupFailed ? "Reconnect Outlook and try again." : "No recent Inbox message from the confirmed Recruiter was found."}</p>}
          </div>
        )}
        {draft.replySourceMessageId && replyRequired && <p className="mt-5 text-sm font-medium text-emerald-800">Original Outlook message selected and verified.</p>}

        {connected && effectiveApproved && !locked && (!replyRequired || draft.replySourceMessageId) && (
          <form action={createExternalDraft} className="mt-5"><button className="rounded-lg bg-blue-700 px-4 py-2.5 font-medium text-white hover:bg-blue-800" type="submit">Create validated Outlook draft</button></form>
        )}
        {draft.outlookState === OutlookDraftState.CREATING && <p className="mt-5 text-sm text-slate-700">Draft creation is in progress. Refresh before retrying.</p>}
        {sentCheckAvailable && <div className="mt-5 flex flex-col items-start gap-3">{outlookLink && <a className="rounded-lg bg-blue-700 px-4 py-2.5 font-medium text-white" href={outlookLink} rel="noreferrer" target="_blank">Open Outlook draft</a>}<form action={confirmSent}><button className="rounded-lg border border-slate-400 bg-white px-4 py-2.5 font-medium text-slate-800" type="submit">I sent it — verify in Outlook</button></form></div>}
        {draft.outlookState === OutlookDraftState.SENT && <>
          <p className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm font-medium text-emerald-900">Outlook confirmed the message was sent; CRM outreach tracking is updated.</p>
          {draft.sentBody !== null && <details className="mt-4 rounded-xl border border-slate-200 p-4"><summary className="cursor-pointer text-sm font-semibold text-slate-800">Archived sent version</summary><dl className="mt-3 space-y-2 text-sm text-slate-700"><div><dt className="font-medium text-slate-950">To</dt><dd>{draft.sentToAddress}</dd></div><div><dt className="font-medium text-slate-950">Subject</dt><dd>{draft.sentSubject}</dd></div><div><dt className="font-medium text-slate-950">Body</dt><dd className="whitespace-pre-wrap">{draft.sentBody}</dd></div></dl><p className="mt-3 text-xs text-slate-500">This is what left your mailbox. The approved draft above is kept unchanged for comparison.</p></details>}
        </>}
        <p className="mt-5 text-xs text-slate-500">Permission: delegated Mail.ReadWrite. Mail.Send is not requested and no send endpoint exists.</p>
      </section>
    </div>
  );
}
