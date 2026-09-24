import { OutreachDraftStatus } from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import { autopilotApplies } from "@/services/autopilot";
import { AutopilotHold, autoConfirmIntake } from "@/services/intake-confirm";
import { addRequiredReviewWarnings, parseJobCase, type JobCase } from "@/services/job-case";
import { analyzeJobText } from "@/services/job-analyzer";
import { activeRoleFamilies } from "@/services/role-family";
import { loadOutreachContext } from "@/services/outreach-context";
import {
  determineOutreachMode,
  generateOutreachContent,
  outreachBlockingIssues,
  validateOutreachContent,
  type OutreachInput,
  type OutreachValidation,
} from "@/services/outreach-agent";
import { buildOutlookDraftForJob } from "@/services/outlook-draft";
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
  /** Why the autopilot left a finished email for the user instead of confirming it. */
  hold: string | null;
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
  hold: null,
});

async function savePreview(intakeId: string, preview: IntakePreview) {
  await getPrisma().jobIntake.update({
    where: { id: intakeId },
    data: { preview: preview as unknown as Prisma.InputJsonValue },
  });
}

/** Prisma reports a row that is required but gone as P2025, whatever step reached for it. */
function intakeDiscarded(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2025";
}

/**
 * Runs analysis, deterministic resume routing, drafting and validation before any Opportunity exists.
 * The result is a preview the user confirms, unless the autopilot applies to this intake: then an
 * acceptable email is confirmed and built into an Outlook draft here, and anything else waits.
 */
export async function runIntakePipeline(intakeId: string, task?: TaskHandle) {
  try {
    await prepareIntake(intakeId, task);
  } catch (error) {
    // Discarding a source deletes its row. A run already under way then has nothing left to write,
    // which is the user finishing with it, not a failure worth a red notice and a Prisma stack.
    if (!intakeDiscarded(error)) throw error;
  }
}

async function prepareIntake(intakeId: string, task?: TaskHandle) {
  const intake = await getPrisma().jobIntake.findUniqueOrThrow({ where: { id: intakeId } });
  const autopilot = autopilotApplies(intake);

  await task?.progress("Analyzing the job description");
  const analysis: JobCase = intake.analysis
    ? parseJobCase(intake.analysis)
    : addRequiredReviewWarnings(await analyzeJobText({
        sourceType: intake.sourceType,
        rawText: intake.rawText,
        originalSender: intake.originalSender,
        roleFamilies: await activeRoleFamilies(),
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
    { allowSeveral: autopilot },
  );
  const resumeId = route.recommended?.id ?? null;

  // Drafting an email that is certain to be rewritten wastes a call, so the pipeline stops early
  // and hands the remaining decision back to the user.
  if (!analysis.recruiterEmail) {
    // The analyzer often knows exactly why -- an address that belongs to the poster, say -- and that
    // reason is worth more than the bare fact that no recipient exists.
    const reason = analysis.warnings.find((warning) => warning.field === "recruiterEmail")?.message;
    return savePreview(intakeId, stopped(`No recruiter email was found, so no outreach email could be written.${reason ? ` ${reason}` : ""} Add one, then generate the draft from the job.`, resumeId));
  }
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

  let content = await generateOutreachContent(input);
  await task?.progress("Validating the draft");
  let validation = await validateOutreachContent(input, content);
  // Nobody is waiting to fix a rejected email, so the autopilot hands the auditor's reasons back to
  // the writer once. What still fails after that is left for the user.
  if (autopilot && validation.status !== "PASS") {
    await task?.progress("Rewriting the draft to fix the validation issues");
    content = await generateOutreachContent(input, {}, { previous: content, issues: validation.issues });
    validation = await validateOutreachContent(input, content);
  }

  const preview: IntakePreview = {
    resumeId,
    mode: input.mode,
    toAddress: input.toAddress,
    subject: content.subject,
    body: content.body,
    validation,
    status: validation.status === "PASS" ? OutreachDraftStatus.DRAFT : OutreachDraftStatus.NEEDS_REVIEW,
    brake: null,
    hold: null,
  };
  await savePreview(intakeId, preview);
  if (autopilot) await runAutopilot(intakeId, analysis, preview, task);
}

/** Confirms the intake and builds its Outlook draft, or records why it waits for the user instead. */
async function runAutopilot(intakeId: string, analysis: JobCase, preview: IntakePreview, task?: TaskHandle) {
  await task?.progress("Confirming the job and building the Outlook draft");
  let opportunityId: string;
  try {
    opportunityId = await autoConfirmIntake(intakeId, analysis, preview);
  } catch (error) {
    // Anything the autopilot cannot finish stays in the queue with its reason, never silently.
    const hold = error instanceof AutopilotHold ? error.message : `The autopilot could not confirm this job: ${error instanceof Error ? error.message : "unknown error"}`;
    return savePreview(intakeId, { ...preview, hold: hold.slice(0, 500) });
  }
  // From here the job exists; a refused or failed Outlook draft records its reason on the draft itself.
  try { await buildOutlookDraftForJob(opportunityId); } catch { /* recorded on the draft */ }
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
    hold: text("hold"),
  };
}
