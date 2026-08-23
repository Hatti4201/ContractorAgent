import { OutreachDraftStatus } from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import { addRequiredReviewWarnings, parseJobCase, type JobCase } from "@/services/job-case";
import { analyzeJobText } from "@/services/job-analyzer";
import { loadOutreachContext } from "@/services/outreach-context";
import {
  determineOutreachMode,
  generateOutreachContent,
  outreachBlockingIssues,
  validateOutreachContent,
  type OutreachInput,
  type OutreachValidation,
} from "@/services/outreach-agent";
import { buildResumeRoute, RESUME_CONFIDENCE_THRESHOLD } from "@/services/resume-router";
import type { TaskHandle } from "@/services/tasks";

export type IntakePreview = {
  resumeId: string | null;
  mode: string | null;
  toAddress: string | null;
  subject: string | null;
  body: string | null;
  validation: OutreachValidation | null;
  status: OutreachDraftStatus;
  brake: string | null;
};

const stopped = (brake: string, resumeId: string | null = null): IntakePreview => ({
  resumeId,
  mode: null,
  toAddress: null,
  subject: null,
  body: null,
  validation: null,
  status: OutreachDraftStatus.NEEDS_REVIEW,
  brake,
});

async function savePreview(intakeId: string, preview: IntakePreview) {
  await getPrisma().jobIntake.update({
    where: { id: intakeId },
    data: { preview: preview as unknown as Prisma.InputJsonValue },
  });
}

/**
 * Runs analysis, deterministic resume routing, drafting and validation before any Opportunity exists.
 * Nothing here becomes authoritative CRM data; the result is a preview the user confirms.
 */
export async function runIntakePipeline(intakeId: string, task?: TaskHandle) {
  const intake = await getPrisma().jobIntake.findUniqueOrThrow({ where: { id: intakeId } });

  await task?.progress("Analyzing the job description");
  const analysis: JobCase = intake.analysis
    ? parseJobCase(intake.analysis)
    : addRequiredReviewWarnings(await analyzeJobText({
        sourceType: intake.sourceType,
        rawText: intake.rawText,
        originalSender: intake.originalSender,
      }));
  await getPrisma().jobIntake.update({
    where: { id: intakeId },
    data: { analysis: analysis as unknown as Prisma.InputJsonValue },
  });

  await task?.progress("Routing the resume");
  const route = await buildResumeRoute(
    analysis.roleFamily,
    analysis.confidence,
    await getPrisma().resume.findMany({ where: { active: true } }),
  );
  const resumeId = route.recommended?.id ?? null;

  // Drafting an email that is certain to be rewritten wastes a call, so the pipeline stops early
  // and hands the remaining decision back to the user.
  if (!analysis.recruiterEmail) return savePreview(intakeId, stopped("No recruiter email was found, so no outreach email could be written. Add one, then generate the draft from the job.", resumeId));
  if (analysis.confidence < RESUME_CONFIDENCE_THRESHOLD) return savePreview(intakeId, stopped("Analysis confidence is below 70%. Review the facts first, then generate the draft from the job.", resumeId));
  if (!route.recommended) return savePreview(intakeId, stopped(route.issue ?? "No usable resume matched this role family.", resumeId));

  await task?.progress("Writing the outreach email");
  const input: OutreachInput = {
    mode: determineOutreachMode(intake.sourceType, []),
    toAddress: analysis.recruiterEmail,
    recruiterName: analysis.recruiterName,
    jobCase: analysis,
    resume: route.recommended,
    source: { sourceType: intake.sourceType, originalSender: intake.originalSender, rawText: intake.rawText },
    activityTypes: [],
    activitySummary: [],
    approvedContext: await loadOutreachContext(),
  };
  const blockers = await outreachBlockingIssues(input);
  if (blockers.length) return savePreview(intakeId, stopped(blockers[0]!.message, resumeId));

  const content = await generateOutreachContent(input);
  await task?.progress("Validating the draft");
  const validation = await validateOutreachContent(input, content);

  await savePreview(intakeId, {
    resumeId,
    mode: input.mode,
    toAddress: input.toAddress,
    subject: content.subject,
    body: content.body,
    validation,
    status: validation.status === "PASS" ? OutreachDraftStatus.DRAFT : OutreachDraftStatus.NEEDS_REVIEW,
    brake: null,
  });
}

export function parseIntakePreview(value: unknown): IntakePreview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const preview = value as Record<string, unknown>;
  const text = (name: string) => (typeof preview[name] === "string" ? preview[name] as string : null);
  return {
    resumeId: text("resumeId"),
    mode: text("mode"),
    toAddress: text("toAddress"),
    subject: text("subject"),
    body: text("body"),
    validation: preview.validation as OutreachValidation | null ?? null,
    status: preview.status === OutreachDraftStatus.DRAFT ? OutreachDraftStatus.DRAFT : OutreachDraftStatus.NEEDS_REVIEW,
    brake: text("brake"),
  };
}
