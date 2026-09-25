import { IntakeStatus, OutreachDraftStatus, OutreachMode } from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import { applicationDecision, pitchedCase, readStoredPolicy, type StoredPolicy } from "@/services/application-policy";
import { AUTOPILOT_MIN_CONFIDENCE, autopilotApplies, autopilotMatchHold, autopilotRoute } from "@/services/autopilot";
import { AutopilotHold, autoConfirmIntake } from "@/services/intake-confirm";
import { addRequiredReviewWarnings, parseJobCase, type JobCase } from "@/services/job-case";
import { analyzeJobText } from "@/services/job-analyzer";
import { assessMatch, readMatchReport, type MatchReport } from "@/services/match-score";
import { triagePosts } from "@/services/post-triage";
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
import { scheduleAutoSend } from "@/services/auto-send";
import { outlookAccessToken } from "@/services/outlook-auth";
import { buildOutlookDraftForJob } from "@/services/outlook-draft";
import { listOutlookSourceMessages } from "@/services/outlook-graph";
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
  /** Null when scoring failed; the autopilot then holds rather than guess. */
  match: MatchReport | null;
  /** The Outlook message a reply answers, chosen by the autopilot; the review screen picks its own. */
  replySourceMessageId: string | null;
};

const stopped = (brake: string, resumeId: string | null, match: MatchReport | null): IntakePreview => ({
  resumeId,
  mode: null,
  toAddress: null,
  subject: null,
  body: null,
  validation: null,
  status: OutreachDraftStatus.NEEDS_REVIEW,
  brake,
  hold: null,
  match,
  replySourceMessageId: null,
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
  const autopilot = autopilotApplies();

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

  // The user's rules come before anything that costs a call: a job they would never take is not
  // scored or written to, and an autopilot skip leaves the queue, since it needs nothing from them.
  await task?.progress("Checking your application rules");
  const policy = await intakePolicy(intakeId, intake.rawText, intake.policy);
  if (!policy) return savePreview(intakeId, stopped("Your application rules could not be checked, so nothing was written. Open the job to decide yourself.", null, null));
  if (policy.decision.verdict === "SKIP") {
    await getPrisma().jobIntake.updateMany({
      where: { id: intakeId, status: IntakeStatus.PENDING },
      data: {
        preview: stopped(`Skipped by your application rules: ${policy.decision.reason}`, null, null) as unknown as Prisma.InputJsonValue,
        ...(autopilot ? { status: IntakeStatus.SKIPPED } : {}),
      },
    });
    return;
  }
  const pitched = pitchedCase(analysis, policy.decision);
  if (pitched !== analysis) await getPrisma().jobIntake.update({ where: { id: intakeId }, data: { analysis: pitched as unknown as Prisma.InputJsonValue } });
  return continueIntake(intakeId, intake, pitched, autopilot, task);
}

/**
 * The facts a sweep already read come with the intake; anything else, mail included, is read here with
 * the same screen. Null when they cannot be read, and the job then waits rather than risk a rule.
 */
async function intakePolicy(intakeId: string, rawText: string, stored: unknown): Promise<StoredPolicy | null> {
  const known = readStoredPolicy(stored);
  if (known) return known;
  try {
    const [screened] = await triagePosts([rawText], await activeRoleFamilies());
    const policy = { facts: screened!.facts, decision: applicationDecision(screened!.facts) };
    await getPrisma().jobIntake.update({ where: { id: intakeId }, data: { policy: policy as unknown as Prisma.InputJsonValue } });
    return policy;
  } catch {
    return null;
  }
}

async function continueIntake(
  intakeId: string,
  intake: { sourceType: IntakeSourceFacts["sourceType"]; sourceMessageId: string | null; originalSender: string | null; rawText: string },
  analysis: JobCase,
  autopilot: boolean,
  task?: TaskHandle,
) {
  // Scored for every intake, so the review screen shows the fit too; a failure only costs the autopilot.
  await task?.progress("Scoring the match against your profile");
  let match: MatchReport | null = null;
  try { match = await assessMatch(analysis, await loadOutreachContext()); } catch { match = null; }

  await task?.progress("Routing the resume");
  const minConfidence = autopilot ? AUTOPILOT_MIN_CONFIDENCE : RESUME_CONFIDENCE_THRESHOLD;
  const route = await buildResumeRoute(
    analysis.roleFamily,
    analysis.confidence,
    await getPrisma().resume.findMany({ where: { active: true } }),
    { allowSeveral: autopilot, minConfidence },
  );
  const resumeId = route.recommended?.id ?? null;
  const stop = (brake: string) => savePreview(intakeId, stopped(brake, resumeId, match));

  // Drafting an email that is certain to be rewritten wastes a call, so the pipeline stops early
  // and hands the remaining decision back to the user.
  if (!analysis.recruiterEmail) {
    // The analyzer often knows exactly why -- an address that belongs to the poster, say -- and that
    // reason is worth more than the bare fact that no recipient exists.
    const reason = analysis.warnings.find((warning) => warning.field === "recruiterEmail")?.message;
    return stop(`No recruiter email was found, so no outreach email could be written.${reason ? ` ${reason}` : ""} Add one, then generate the draft from the job.`);
  }
  if (analysis.confidence < minConfidence) return stop(`Analysis confidence is below ${Math.round(minConfidence * 100)}%. Review the facts first, then generate the draft from the job.`);
  if (!route.recommended) return stop(route.issue ?? "No usable resume matched this role family.");

  const outreach = autopilot
    ? await resolveRoute(intake, analysis.recruiterEmail)
    : { mode: determineOutreachMode(intake.sourceType, []), replySourceMessageId: null };

  await task?.progress("Writing the outreach email");
  const input: OutreachInput = {
    mode: outreach.mode,
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
  if (blockers.length) return stop(blockers[0]!.message);

  let content = await generateOutreachContent(input);
  await task?.progress("Validating the draft");
  let validation = await validateOutreachContent(input, content);
  // Nobody is waiting to fix a rejected email, so the autopilot hands the auditor's reasons back to
  // the writer once. What still fails after that is left for the user, and a job the match already
  // holds back is not worth the second call.
  if (autopilot && !autopilotMatchHold(match) && validation.status !== "PASS") {
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
    match,
    replySourceMessageId: outreach.replySourceMessageId,
  };
  await savePreview(intakeId, preview);
  if (autopilot) await runAutopilot(intakeId, analysis, preview, task);
}

type IntakeSourceFacts = Parameters<typeof autopilotRoute>[0];

/**
 * The mode is settled before the email is written, because a reply and a new email read differently.
 * A pasted email from the recruiter is answered in their Outlook thread when one of their recent
 * messages is there to answer, and otherwise as a new email rather than waiting for someone to pick one.
 */
async function resolveRoute(intake: Parameters<typeof autopilotRoute>[0], recruiterEmail: string) {
  const route = autopilotRoute(intake, recruiterEmail);
  if (route.thread === "source") return { mode: route.mode, replySourceMessageId: intake.sourceMessageId };
  if (route.thread === "lookup") {
    try {
      const [latest] = await listOutlookSourceMessages(recruiterEmail, { accessToken: await outlookAccessToken() });
      if (latest) return { mode: route.mode, replySourceMessageId: latest.id };
    } catch { /* Outlook unavailable: write a new email instead */ }
    return { mode: OutreachMode.FIRST_OUTREACH, replySourceMessageId: null };
  }
  return { mode: route.mode, replySourceMessageId: null };
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
  // From here the job exists; a refused or failed Outlook draft records its reason on the draft itself,
  // and only a draft that really reached Outlook is scheduled (or shadow-recorded) for sending.
  try { await buildOutlookDraftForJob(opportunityId); } catch { return; }
  await scheduleAutoSend(opportunityId);
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
    match: readMatchReport(preview.match),
    replySourceMessageId: text("replySourceMessageId"),
  };
}
