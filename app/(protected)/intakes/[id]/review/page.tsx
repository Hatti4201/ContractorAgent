import Link from "next/link";
import { ArrowLeft, Copy, FileText, Gauge, Hand, Info, Loader, OctagonAlert, Paperclip, TriangleAlert } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { confirmIntake, confirmIntakeWithDraft } from "@/app/(protected)/jobs/actions";
import { EmploymentType, IntakeStatus, type OutreachMode } from "@/app/generated/prisma/enums";
import { JobCaseReviewForm } from "@/components/job-case-review-form";
import { HoverLabel, labelScope } from "@/components/hover-label";
import { MatchReportSection } from "@/components/match-report";
import { SweepRefresher } from "@/components/sweep-paste";
import { currentMatchThreshold } from "@/services/auto-send";
import { formatEnum } from "@/lib/job-values";
import { getPrisma } from "@/lib/prisma";
import { parseIntakePreview } from "@/services/intake-pipeline";
import { currentEmployerCcSetting } from "@/services/employer";
import { detectRecruiterProfile } from "@/services/intake-source";
import { outlookConnected } from "@/services/outlook-auth";
import { listOutlookSourceMessages, replyModes } from "@/services/outlook-graph";
import { outlookAccessToken } from "@/services/outlook-auth";
import { findDuplicateMatches, parseJobCase } from "@/services/job-case";
import { activeRoleFamilies } from "@/services/role-family";

function attachments(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export default async function IntakeReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const database = getPrisma();
  const intake = await database.jobIntake.findUnique({ where: { id } });
  if (!intake) notFound();
  if (intake.status === IntakeStatus.CONFIRMED && intake.opportunityId) redirect(`/jobs/${intake.opportunityId}`);

  if (!intake.analysis) {
    return (
      <div className="mx-auto flex max-w-3xl items-center justify-center gap-3 px-6 py-16 text-slate-500">
        {/* The analysis lands on its own; look again every few seconds rather than asking for a reload. */}
        <SweepRefresher active />
        <Link aria-label="Back to jobs" className={`relative ${labelScope.bar} rounded-lg p-1.5 hover:bg-slate-100 hover:text-slate-900`} href="/jobs" title="Back to jobs"><ArrowLeft aria-hidden="true" size={18} /><HoverLabel scope="bar" text="返回岗位" /></Link>
        <Loader aria-hidden="true" className="animate-spin" size={20} />
        <span className="text-sm" role="status">Preparing</span>
      </div>
    );
  }

  const jobCase = parseJobCase(intake.analysis);
  const preview = parseIntakePreview(intake.preview);
  const resumes = await database.resume.findMany({
    where: { active: true },
    select: { id: true, name: true, version: true, roleFamily: true },
    orderBy: [{ roleFamily: "asc" }, { name: "asc" }],
  });
  const roleFamilies = await activeRoleFamilies(database);
  const candidates = await database.opportunity.findMany({
    select: {
      id: true,
      title: true,
      client: true,
      location: true,
      employmentType: true,
      rawJd: true,
      jobCase: true,
      jdFingerprint: true,
      createdAt: true,
      vendor: { select: { name: true } },
      recruiter: { select: { name: true } },
      applicationTrack: { select: { currentStage: true } },
    },
  });
  const duplicates = findDuplicateMatches(jobCase, intake.fingerprint, intake.receivedAt, candidates);
  const confirm = confirmIntake.bind(null, intake.id, false);
  const markDuplicate = confirmIntake.bind(null, intake.id, true);
  const confirmAndDraft = confirmIntakeWithDraft.bind(null, intake.id);
  // One click may run the rest of the chain only where nothing is left to decide: a first outreach
  // the validator passed, with a resume routed and Outlook connected. Anything else keeps its stop.
  const replyRequired = Boolean(preview?.mode && replyModes.has(preview.mode as OutreachMode));
  // Offered even for a first outreach: a paste loses the headers that would have made this a reply,
  // and picking the thread here is how the user puts that back.
  let threads: Awaited<ReturnType<typeof listOutlookSourceMessages>> = [];
  if (jobCase.recruiterEmail && await outlookConnected()) {
    try { threads = await listOutlookSourceMessages(jobCase.recruiterEmail, { accessToken: await outlookAccessToken() }); } catch { threads = []; }
  }
  const straightThrough = Boolean(
    preview?.mode
      && (!replyRequired || threads.length > 0)
      && preview.validation?.status === "PASS"
      && preview.resumeId
      && await outlookConnected(),
  );
  const files = attachments(intake.attachmentMetadata);
  // Only warnings that ask something of the user; the rest are already visible in the fields.
  const openWarnings = jobCase.warnings.filter((warning) => warning.severity === "CONFLICT" || warning.severity === "NEEDS_REVIEW");
  // An INFO note can be the whole explanation -- "that address is the poster's own" -- so it stays
  // one click away rather than being dropped.
  const notes = jobCase.warnings.filter((warning) => !openWarnings.includes(warning));
  // The employer copy address never comes from the model; C2C only decides whether it starts ticked.
  const employer = await currentEmployerCcSetting();
  const employerCopy = employer.address
    ? { address: employer.address, defaultOn: jobCase.employmentType === EmploymentType.C2C }
    : null;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex flex-wrap items-center gap-2">
        <Link aria-label="New analysis" className={`relative ${labelScope.bar} rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900`} href="/intake" title="New analysis"><ArrowLeft aria-hidden="true" size={18} /><HoverLabel scope="bar" text="新建分析" /></Link>
        <h1 className="min-w-0 truncate text-xl font-semibold text-slate-950" title={jobCase.title ?? undefined}>{jobCase.title ?? "Untitled job"}</h1>
        <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600" title="Analysis confidence">
          <Gauge aria-hidden="true" size={13} />{Math.round(jobCase.confidence * 100)}%
        </span>
        {files.length > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600" title={`Attachments: ${files.join(", ")}`}>
            <Paperclip aria-hidden="true" size={13} />{files.length}
          </span>
        )}
      </div>

      {preview?.hold && (
        <p className="mt-4 flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-950" role="status" title={`The autopilot left this job for you: ${preview.hold}`}>
          <Hand aria-hidden="true" className="shrink-0" size={16} /><span className="sm:truncate">{preview.hold}</span>
        </p>
      )}

      {preview && <MatchReportSection report={preview.match} threshold={await currentMatchThreshold()} />}

      {openWarnings.length > 0 && (
        <ul aria-label="Warnings" className="mt-4 space-y-2">
          {openWarnings.map((warning, index) => {
            const conflict = warning.severity === "CONFLICT";
            const Icon = conflict ? OctagonAlert : TriangleAlert;
            return (
              <li className={`flex items-start gap-2 rounded-xl border px-4 py-2 text-sm ${conflict ? "border-red-300 bg-red-50 text-red-950" : "border-amber-300 bg-amber-50 text-amber-950"}`} key={`${warning.field}-${index}`} title={warning.evidence ? `Source: “${warning.evidence}”` : undefined}>
                <Icon aria-label={formatEnum(warning.severity)} className="mt-0.5 shrink-0" size={15} />
                <span><span className="font-semibold">{formatEnum(warning.field)}</span> · {warning.message}</span>
              </li>
            );
          })}
        </ul>
      )}

      {(notes.length > 0 || duplicates.length > 0) && (
        <div className="mt-4 flex flex-wrap items-start gap-2">
          {notes.length > 0 && (
            <details className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-slate-600 [&::-webkit-details-marker]:hidden" title="What the analysis also noticed">
                <Info aria-hidden="true" size={15} />{notes.length}
              </summary>
              <ul className="mt-2 space-y-1 text-sm text-slate-700">
                {notes.map((warning, index) => (
                  <li key={`${warning.field}-${index}`}><span className="font-medium text-slate-950">{formatEnum(warning.field)}</span> · {warning.message}</li>
                ))}
              </ul>
            </details>
          )}
          {duplicates.length > 0 && (
            <details className={`min-w-0 flex-1 rounded-xl border bg-white px-3 py-2 ${duplicates.some((match) => match.exact) ? "border-amber-300" : "border-slate-200"}`}>
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-slate-600 [&::-webkit-details-marker]:hidden" title="Other channels for this role">
                <Copy aria-hidden="true" size={15} />{duplicates.length}
              </summary>
              <ul className="mt-2 space-y-1.5">
                {duplicates.map((match) => (
                  <li className="flex items-center gap-2 text-sm" key={match.id} title={match.reasons.join(" · ")}>
                    <Link className="min-w-0 truncate font-medium text-slate-900 hover:text-emerald-700" href={`/jobs/${match.id}`}>{match.title}</Link>
                    <span className="min-w-0 truncate text-xs text-slate-500">{[match.vendor, match.recruiter, match.client, match.rate].filter(Boolean).join(" · ")}</span>
                    {match.stage && <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{formatEnum(match.stage)}</span>}
                    <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${match.exact ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-600"}`} title={match.exact ? "Identical JD text" : "Similarity"}>
                      {match.exact ? "=" : `${Math.round(match.score * 100)}%`}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="mt-4">
        <JobCaseReviewForm confirmAction={confirm} confirmAndDraftAction={confirmAndDraft} duplicateAction={markDuplicate} hasExactDuplicate={duplicates.some((match) => match.exact)} straightThrough={straightThrough} employerCopy={employerCopy} threads={threads.length ? threads : null} threadRequired={replyRequired} canWrite={!preview?.subject && Boolean(jobCase.recruiterEmail)} jobCase={jobCase} preview={preview} recruiterLinkedin={detectRecruiterProfile(intake.rawText)} sourceMessageId={intake.sourceMessageId} resumes={resumes} roleFamilies={roleFamilies} source={{ sourceType: intake.sourceType, originalSender: intake.originalSender, receivedAt: intake.receivedAt }} />
      </div>

      <details className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-slate-700 [&::-webkit-details-marker]:hidden" title="Original source text and evidence">
          <FileText aria-hidden="true" size={16} />Source
        </summary>
        <pre className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{intake.rawText}</pre>
        {jobCase.evidence.length > 0 && (
          <ul className="mt-5 space-y-2 border-t border-slate-200 pt-5 text-sm text-slate-700">
            {jobCase.evidence.map((item, index) => <li key={`${item.field}-${index}`}><span className="font-medium">{formatEnum(item.field)}:</span> “{item.quote}”</li>)}
          </ul>
        )}
      </details>
    </div>
  );
}
