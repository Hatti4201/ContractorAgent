import type { Prisma } from "@/app/generated/prisma/client";
import {
  ActivityType,
  ApplicationStage,
  EmploymentType,
  IntakeStatus,
  JobSourceType,
  OutreachDraftStatus,
  OutreachMode,
} from "@/app/generated/prisma/enums";
import { getPrisma } from "@/lib/prisma";
import { autopilotAccepts, autopilotDuplicateHold, autopilotMatchHold } from "@/services/autopilot";
import { resolveContacts } from "@/services/contacts";
import { employerCcSetting } from "@/services/employer";
import type { IntakePreview } from "@/services/intake-pipeline";
import { findDuplicateMatches, type JobCase } from "@/services/job-case";
import type { MatchReport } from "@/services/match-score";
import { replyModes } from "@/services/outlook-graph";
import { loadOutreachContext, outreachContextFingerprint } from "@/services/outreach-context";

type IntakeSource = { sourceType: JobSourceType; originalSender: string | null; receivedAt: Date };

/**
 * Turns one pending intake into an Opportunity. The review screen and the autopilot both come through
 * here, so a job looks the same whoever confirmed it; only the activity text says which one did.
 */
export async function createOpportunityFromIntake(database: Prisma.TransactionClient, input: {
  intake: { id: string; rawText: string; fingerprint: string };
  reviewed: JobCase & { title: string };
  source: IntakeSource;
  recruiterLinkedin: string | null;
  selectedResumeId: string | null;
  match: MatchReport | null;
  markDuplicate: boolean;
  confirmedBy: "user" | "autopilot";
}) {
  const { intake, reviewed, source, selectedResumeId } = input;
  const claimed = await database.jobIntake.updateMany({
    where: { id: intake.id, status: IntakeStatus.PENDING },
    data: { status: IntakeStatus.CONFIRMED, confirmedAt: new Date() },
  });
  if (claimed.count !== 1) throw new Error("Intake was already confirmed.");
  const contacts = await resolveContacts(database, {
    vendorName: reviewed.vendor,
    recruiterName: reviewed.recruiterName,
    recruiterEmail: reviewed.recruiterEmail,
    recruiterPhone: reviewed.recruiterPhone,
    recruiterLinkedin: input.recruiterLinkedin,
  });

  // The analyzer will not guess a family, but picking a resume states one: the registry entry is
  // where the family comes from, the same thing selectResume means by it. Adopting it here creates
  // the job consistent, instead of one that reaches outreach with a resume and no family and blocks
  // the draft on a fact the user already supplied.
  const adoptedRoleFamily = !reviewed.roleFamily && selectedResumeId
    ? (await database.resume.findUnique({ where: { id: selectedResumeId }, select: { roleFamily: true } }))?.roleFamily ?? null
    : null;
  const roleFamily = reviewed.roleFamily ?? adoptedRoleFamily;
  const byAutopilot = input.confirmedBy === "autopilot";

  const created = await database.opportunity.create({
    data: {
      title: reviewed.title,
      client: reviewed.client,
      location: reviewed.location,
      roleFamily,
      employmentType: reviewed.employmentType,
      workArrangement: reviewed.workArrangement,
      rawJd: intake.rawText,
      jobCase: { ...reviewed, roleFamily } as unknown as Prisma.InputJsonValue,
      jdFingerprint: intake.fingerprint,
      selectedResumeId,
      matchScore: input.match?.score ?? null,
      ...(input.match ? { matchReport: input.match as unknown as Prisma.InputJsonValue } : {}),
      ...contacts,
      applicationTrack: { create: { currentStage: input.markDuplicate ? ApplicationStage.DUPLICATE : ApplicationStage.DISCOVERED } },
      activities: {
        create: [
          { type: ActivityType.JOB_CREATED, description: byAutopilot ? "Opportunity created by the autopilot from a scanned email." : "Opportunity created from confirmed AI intake." },
          { type: ActivityType.JD_RECEIVED, description: `JD ${byAutopilot ? "accepted by the autopilot" : "confirmed"} from ${source.sourceType}.` },
          ...(selectedResumeId ? [{ type: ActivityType.RESUME_SELECTED, description: "Resume selected by deterministic role-family mapping." }] : []),
          // Setting a confirmed fact from something other than the review form stays explainable.
          ...(adoptedRoleFamily ? [{ type: ActivityType.CORRECTION, description: `Role family set to ${adoptedRoleFamily} from the chosen resume (was unset).` }] : []),
        ],
      },
    },
  });
  await database.jobIntake.update({ where: { id: intake.id }, data: { opportunityId: created.id, ...source } });
  return { id: created.id, roleFamily };
}

/** Why the autopilot left this intake for the user, or null when it may go ahead. */
export class AutopilotHold extends Error {}

/**
 * Confirms a mailbox intake whose pipeline produced an acceptable email, and writes its approved
 * outreach draft, with no one at the screen. Everything it cannot vouch for throws AutopilotHold and
 * leaves the intake pending, so the user sees it in the queue with that reason.
 */
export async function autoConfirmIntake(intakeId: string, analysis: JobCase, preview: IntakePreview) {
  if (!analysis.title) throw new AutopilotHold("The analysis found no job title.");
  const matchHold = autopilotMatchHold(preview.match);
  if (matchHold) throw new AutopilotHold(matchHold);
  if (!preview.resumeId || !preview.mode || !preview.toAddress || !preview.subject || !preview.body) {
    throw new AutopilotHold("The pipeline did not produce a complete email.");
  }
  if (!autopilotAccepts(preview.validation)) {
    const block = preview.validation?.issues.find((issue) => issue.severity === "BLOCK");
    throw new AutopilotHold(`The email still failed validation after a rewrite${block ? `: ${block.message}` : "."}`);
  }
  const { title } = analysis;
  const mode = preview.mode as OutreachMode;
  // A reply needs the thread it answers; the pipeline only chooses reply mode when it found one.
  const replySourceMessageId = replyModes.has(mode) ? preview.replySourceMessageId : null;
  if (replyModes.has(mode) && !replySourceMessageId) throw new AutopilotHold("There is no Outlook thread to reply into.");
  const email = { toAddress: preview.toAddress, subject: preview.subject, body: preview.body };
  const resumeId = preview.resumeId;
  const validation = preview.validation!;
  const contextFingerprint = outreachContextFingerprint(await loadOutreachContext());

  return getPrisma().$transaction(async (database) => {
    const intake = await database.jobIntake.findUnique({ where: { id: intakeId } });
    if (!intake || intake.status !== IntakeStatus.PENDING) throw new AutopilotHold("The intake is no longer pending.");
    const candidates = await database.opportunity.findMany({
      select: {
        id: true, title: true, client: true, location: true, employmentType: true, rawJd: true, jobCase: true,
        jdFingerprint: true, createdAt: true, vendor: { select: { name: true } }, recruiter: { select: { name: true } },
        applicationTrack: { select: { currentStage: true } },
      },
    });
    const duplicate = autopilotDuplicateHold(analysis, findDuplicateMatches(analysis, intake.fingerprint, intake.receivedAt, candidates));
    if (duplicate) throw new AutopilotHold(duplicate);

    const created = await createOpportunityFromIntake(database, {
      intake,
      reviewed: { ...analysis, title },
      source: { sourceType: intake.sourceType, originalSender: intake.originalSender, receivedAt: intake.receivedAt },
      recruiterLinkedin: null,
      selectedResumeId: resumeId,
      match: preview.match,
      markDuplicate: false,
      confirmedBy: "autopilot",
    });
    await database.outreachDraft.create({
      data: {
        opportunityId: created.id,
        mode,
        // Outlook checks again at draft time that this message really came from the recipient.
        replySourceMessageId,
        ...email,
        // Same default the review screen starts from: C2C copies the employer, from local config only.
        ccAddress: analysis.employmentType === EmploymentType.C2C ? employerCcSetting().address : null,
        attachmentResumeId: resumeId,
        contextFingerprint,
        validation: validation as unknown as Prisma.InputJsonValue,
        status: OutreachDraftStatus.APPROVED,
        approvedAt: new Date(),
      },
    });
    await database.activity.createMany({ data: [
      { opportunityId: created.id, type: ActivityType.OUTREACH_DRAFT_GENERATED, description: "Outreach draft written by the autopilot." },
      {
        opportunityId: created.id,
        type: ActivityType.OUTREACH_DRAFT_APPROVED,
        description: validation.status === "PASS"
          ? "Outreach draft approved by the autopilot: validation passed."
          : `Outreach draft approved by the autopilot with ${validation.issues.length} non-blocking validation note(s).`,
      },
    ] });
    return created.id;
  });
}
