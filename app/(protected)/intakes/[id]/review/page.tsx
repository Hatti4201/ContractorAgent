import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { confirmIntake } from "@/app/(protected)/jobs/actions";
import { IntakeStatus } from "@/app/generated/prisma/enums";
import { JobCaseReviewForm } from "@/components/job-case-review-form";
import { formatEnum } from "@/lib/job-values";
import { getPrisma } from "@/lib/prisma";
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

  const jobCase = parseJobCase(intake.analysis);
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
      applicationTrack: { select: { currentStage: true } },
    },
  });
  const duplicates = findDuplicateMatches(jobCase, intake.fingerprint, intake.receivedAt, candidates);
  const confirm = confirmIntake.bind(null, intake.id, false);
  const markDuplicate = confirmIntake.bind(null, intake.id, true);
  const files = attachments(intake.attachmentMetadata);

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <Link className="text-sm font-medium text-emerald-700 underline" href="/intake">← New analysis</Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Review before confirm</p>
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
        <h2 className="text-xl font-semibold text-slate-950">Possible duplicates</h2>
        {duplicates.length ? (
          <ul className="mt-4 space-y-3">
            {duplicates.map((match) => (
              <li className="rounded-xl border border-amber-200 bg-white p-4" key={match.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link className="font-semibold text-emerald-700 underline" href={`/jobs/${match.id}`}>{match.title}</Link>
                  <span className="text-sm font-semibold text-amber-900">{Math.round(match.score * 100)}% similar</span>
                </div>
                <p className="mt-1 text-sm text-slate-600">{match.client ?? "Client unknown"} · Existing path: {match.stage ? formatEnum(match.stage) : "Not tracked"}</p>
                <p className="mt-2 text-xs text-slate-500">{match.reasons.join(" · ")}</p>
              </li>
            ))}
          </ul>
        ) : <p className="mt-3 text-sm text-slate-600">No likely duplicate found in the current CRM.</p>}
      </section>

      <div className="mt-8">
        <JobCaseReviewForm confirmAction={confirm} duplicateAction={markDuplicate} hasDuplicates={duplicates.length > 0} jobCase={jobCase} source={{ sourceType: intake.sourceType, originalSender: intake.originalSender, receivedAt: intake.receivedAt }} />
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
