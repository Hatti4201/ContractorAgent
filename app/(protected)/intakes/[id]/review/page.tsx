import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { confirmIntake } from "@/app/(protected)/jobs/actions";
import { IntakeStatus, type OutreachMode } from "@/app/generated/prisma/enums";
import { JobCaseReviewForm } from "@/components/job-case-review-form";
import { formatEnum } from "@/lib/job-values";
import { getPrisma } from "@/lib/prisma";
import { parseIntakePreview } from "@/services/intake-pipeline";
import { detectRecruiterProfile } from "@/services/intake-source";
import { outlookConnected } from "@/services/outlook-auth";
import { replyModes } from "@/services/outlook-graph";
import { findDuplicateMatches, parseJobCase } from "@/services/job-case";

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
      <div className="mx-auto max-w-3xl px-6 py-16 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Add job</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Preparing this job</h1>
        <p className="mt-3 text-slate-600">Analysis, resume routing, drafting and validation are running in the background. This page fills in when they finish; the corner tray tracks progress and you can leave.</p>
        <Link className="mt-6 inline-block font-medium text-emerald-700 underline" href="/jobs">Back to jobs</Link>
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
  const confirm = confirmIntake.bind(null, intake.id, false, false);
  const markDuplicate = confirmIntake.bind(null, intake.id, true, false);
  const confirmAndDraft = confirmIntake.bind(null, intake.id, false, true);
  // One click may run the rest of the chain only where nothing is left to decide: a first outreach
  // the validator passed, with a resume routed and Outlook connected. Anything else keeps its stop.
  const straightThrough = Boolean(
    preview?.mode
      && !replyModes.has(preview.mode as OutreachMode)
      && preview.validation?.status === "PASS"
      && preview.resumeId
      && await outlookConnected(),
  );
  const files = attachments(intake.attachmentMetadata);

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <Link className="text-sm font-medium text-emerald-700 underline" href="/intake">← New analysis</Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Add job</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">AI job analysis</h1>
        </div>
        <p className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">Confidence {Math.round(jobCase.confidence * 100)}%</p>
      </div>

      {files.length > 0 && <p className="mt-8 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700"><span className="font-medium">Attachments:</span> {files.join(", ")}</p>}

      <section className="mt-8">
        <h2 className="text-xl font-semibold text-slate-950">Warnings</h2>
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {jobCase.warnings.map((warning, index) => (
            <li className={`rounded-xl border p-4 text-sm ${warning.severity === "CONFLICT" ? "border-red-300 bg-red-50" : warning.severity === "NEEDS_REVIEW" ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`} key={`${warning.field}-${index}`}>
              <p className="font-semibold">{formatEnum(warning.severity)} · {formatEnum(warning.field)}</p>
              <p className="mt-1 text-slate-700">{warning.message}</p>
              {warning.evidence && <p className="mt-2 text-xs text-slate-500">Source: “{warning.evidence}”</p>}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-6">
        <h2 className="text-xl font-semibold text-slate-950">Other channels for this role</h2>
        <p className="mt-1 text-sm text-slate-600">One role reaches you through several vendors, which is normal. Check who is already working it and how far they got.</p>
        {duplicates.length ? (
          <ul className="mt-4 space-y-3">
            {duplicates.map((match) => (
              <li className={`rounded-xl border bg-white p-4 ${match.exact ? "border-amber-300" : "border-slate-200"}`} key={match.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link className="font-semibold text-emerald-700 underline" href={`/jobs/${match.id}`}>{match.title}</Link>
                  <span className={`text-sm font-semibold ${match.exact ? "text-amber-900" : "text-slate-600"}`}>{match.exact ? "Identical JD text" : `${Math.round(match.score * 100)}% match`}</span>
                </div>
                <p className="mt-1 text-sm text-slate-700">{match.vendor ?? "Vendor unknown"} · {match.recruiter ?? "Recruiter unknown"} · {match.stage ? formatEnum(match.stage) : "Not tracked"}</p>
                <p className="mt-1 text-sm text-slate-600">{match.client ?? "Client unknown"}{match.rate ? ` · ${match.rate}` : ""}</p>
                <p className="mt-2 text-xs text-slate-500">{match.reasons.join(" · ")}</p>
              </li>
            ))}
          </ul>
        ) : <p className="mt-3 text-sm text-slate-600">No other opportunity in the CRM looks like this one.</p>}
      </section>

      <div className="mt-8">
        <JobCaseReviewForm confirmAction={confirm} confirmAndDraftAction={confirmAndDraft} duplicateAction={markDuplicate} hasExactDuplicate={duplicates.some((match) => match.exact)} straightThrough={straightThrough} jobCase={jobCase} preview={preview} recruiterLinkedin={detectRecruiterProfile(intake.rawText)} resumes={resumes} source={{ sourceType: intake.sourceType, originalSender: intake.originalSender, receivedAt: intake.receivedAt }} />
      </div>

      <details className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
        <summary className="cursor-pointer font-semibold text-slate-950">Original source text and evidence</summary>
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
