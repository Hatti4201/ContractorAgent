"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  ActivityType,
  ApplicationStage,
  EmploymentType,
  IntakeStatus,
  JobSourceType,
  OutlookDraftState,
  OutreachDraftStatus,
  OutreachMode,
  RoleFamily,
  WorkArrangement,
} from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";
import { buildOutlookDraft } from "@/app/(protected)/jobs/[id]/outlook/actions";
import { outlookAccessToken } from "@/services/outlook-auth";
import { replyModes, validateOutlookSourceMessage } from "@/services/outlook-graph";
import { requireAuth } from "@/lib/auth";
import { dateTimeValue, dateValue } from "@/lib/job-values";
import { getPrisma } from "@/lib/prisma";
import { jobCaseFactChanges, jobFingerprint, parseJobCase, readJobCaseFacts, readReviewedJobCase } from "@/services/job-case";
import { profileUrl, resolveContacts } from "@/services/contacts";
import { employerCcSetting } from "@/services/employer";
import { parseIntakePreview } from "@/services/intake-pipeline";
import { loadOutreachContext, outreachContextFingerprint } from "@/services/outreach-context";
import { buildResumeRoute, checkResumeFile } from "@/services/resume-router";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const outdatedOutreachValidation = {
  status: "NEEDS_REVIEW",
  issues: [{ field: "source", severity: "BLOCK", message: "Job or Resume data changed; validate the outreach draft again." }],
} satisfies Prisma.InputJsonValue;
const threadChosenValidation = {
  status: "NEEDS_REVIEW",
  issues: [{ field: "mode", severity: "NEEDS_REVIEW", message: "You chose a thread to reply into, so the email has to be written and validated as a reply." }],
} satisfies Prisma.InputJsonValue;
const editedOutreachValidation = {
  status: "NEEDS_REVIEW",
  issues: [{ field: "body", severity: "NEEDS_REVIEW", message: "You edited the email after it was validated; validate it again before approval." }],
} satisfies Prisma.InputJsonValue;

function readReviewedDraft(formData: FormData) {
  const toAddress = text(formData, "draftToAddress", 320);
  const subject = text(formData, "draftSubject", 300);
  const body = text(formData, "draftBody", 10_000);
  return toAddress && subject && body ? { toAddress, subject, body } : null;
}
const stageActivityType: Partial<Record<ApplicationStage, ActivityType>> = {
  OUTREACH_SENT: ActivityType.OUTREACH_SENT,
  RTR_SIGNED: ActivityType.RTR_SIGNED,
  SUBMITTED_TO_CLIENT: ActivityType.CLIENT_SUBMISSION,
  INTERVIEW_SCHEDULED: ActivityType.INTERVIEW_SCHEDULED,
  INTERVIEW_COMPLETED: ActivityType.INTERVIEW_COMPLETED,
  OFFER: ActivityType.OFFER,
};

function text(formData: FormData, name: string, maximum: number, required = false) {
  const value = formData.get(name);
  const cleaned = typeof value === "string" ? value.trim() : "";
  if (required && !cleaned) throw new Error(`${name} is required.`);
  if (cleaned.length > maximum) throw new Error(`${name} is too long.`);
  return cleaned || null;
}

function enumValue<T extends string>(value: FormDataEntryValue | null, allowed: readonly T[], fallback: T) {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function optionalEnumValue<T extends string>(value: FormDataEntryValue | null, allowed: readonly T[]) {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : null;
}

function readJob(formData: FormData) {
  const recruiterEmail = text(formData, "recruiterEmail", 320);
  const recruiterName = text(formData, "recruiterName", 200);
  const recruiterPhone = text(formData, "recruiterPhone", 80);
  if (recruiterEmail && !emailPattern.test(recruiterEmail)) throw new Error("Invalid recruiter email.");
  if ((recruiterEmail || recruiterPhone) && !recruiterName) throw new Error("Recruiter name is required with contact details.");

  return {
    title: text(formData, "title", 200, true)!,
    client: text(formData, "client", 200),
    location: text(formData, "location", 200),
    roleFamily: optionalEnumValue(formData.get("roleFamily"), Object.values(RoleFamily)),
    employmentType: enumValue(formData.get("employmentType"), Object.values(EmploymentType), EmploymentType.UNKNOWN),
    workArrangement: enumValue(formData.get("workArrangement"), Object.values(WorkArrangement), WorkArrangement.UNKNOWN),
    rawJd: text(formData, "rawJd", 50000),
    vendorName: text(formData, "vendorName", 200),
    recruiterName,
    recruiterEmail,
    recruiterPhone,
    currentStage: enumValue(formData.get("currentStage"), Object.values(ApplicationStage), ApplicationStage.DISCOVERED),
    waitingOn: text(formData, "waitingOn", 500),
    nextAction: text(formData, "nextAction", 500),
    nextFollowUpAt: dateValue(formData.get("nextFollowUpAt")),
  };
}

async function automaticResumeId(database: Prisma.TransactionClient, roleFamily: RoleFamily | null, confidence: number) {
  if (!roleFamily) return null;
  const route = await buildResumeRoute(roleFamily, confidence, await database.resume.findMany({ where: { roleFamily, active: true } }));
  return route.recommended?.id ?? null;
}

export async function createJob(formData: FormData) {
  await requireAuth();
  const data = readJob(formData);

  const opportunity = await getPrisma().$transaction(async (database) => {
    const contacts = await resolveContacts(database, data);
    const selectedResumeId = await automaticResumeId(database, data.roleFamily, 1);
    const initialActivities: Prisma.ActivityCreateWithoutOpportunityInput[] = [
      { type: ActivityType.JOB_CREATED, description: "Opportunity created manually." },
    ];
    if (selectedResumeId) initialActivities.push({ type: ActivityType.RESUME_SELECTED, description: "Resume selected by deterministic role-family mapping." });
    const initialBusinessEvent = stageActivityType[data.currentStage];
    if (initialBusinessEvent) initialActivities.push({
      type: initialBusinessEvent,
      description: `Recorded automatically from initial stage ${data.currentStage}.`,
    });
    return database.opportunity.create({
      data: {
        title: data.title,
        client: data.client,
        location: data.location,
        roleFamily: data.roleFamily,
        employmentType: data.employmentType,
        workArrangement: data.workArrangement,
        rawJd: data.rawJd,
        jdFingerprint: data.rawJd ? jobFingerprint(data.rawJd) : null,
        selectedResumeId,
        ...contacts,
        applicationTrack: {
          create: {
            currentStage: data.currentStage,
            waitingOn: data.waitingOn,
            nextAction: data.nextAction,
            nextFollowUpAt: data.nextFollowUpAt,
          },
        },
        activities: {
          create: initialActivities,
        },
      },
    });
  });

  revalidatePath("/dashboard");
  revalidatePath("/needs-attention");
  revalidatePath("/jobs");
  redirect(`/jobs/${opportunity.id}`);
}

export async function updateJob(id: string, formData: FormData) {
  await requireAuth();
  const data = readJob(formData);

  await getPrisma().$transaction(async (database) => {
    const existing = await database.opportunity.findUnique({
      where: { id },
      include: { applicationTrack: true },
    });
    if (!existing?.applicationTrack) throw new Error("Job not found.");

    const contacts = await resolveContacts(database, data, existing.recruiterId);
    const syncedJobCase = existing.jobCase ? {
      ...parseJobCase(existing.jobCase),
      title: data.title,
      client: data.client,
      vendor: data.vendorName,
      recruiterName: data.recruiterName,
      recruiterEmail: data.recruiterEmail,
      recruiterPhone: data.recruiterPhone,
      location: data.location,
      roleFamily: data.roleFamily,
      employmentType: data.employmentType,
      workArrangement: data.workArrangement,
    } : null;
    const selectedResumeId = data.roleFamily === existing.roleFamily
      ? existing.selectedResumeId
      : await automaticResumeId(database, data.roleFamily, syncedJobCase?.confidence ?? 1);
    await database.opportunity.update({
      where: { id },
      data: {
        title: data.title,
        client: data.client,
        location: data.location,
        roleFamily: data.roleFamily,
        employmentType: data.employmentType,
        workArrangement: data.workArrangement,
        rawJd: data.rawJd,
        ...(syncedJobCase ? { jobCase: syncedJobCase as unknown as Prisma.InputJsonValue } : {}),
        jdFingerprint: data.rawJd ? jobFingerprint(data.rawJd) : null,
        selectedResumeId,
        ...contacts,
      },
    });
    await database.applicationTrack.update({
      where: { opportunityId: id },
      data: {
        currentStage: data.currentStage,
        waitingOn: data.waitingOn,
        nextAction: data.nextAction,
        nextFollowUpAt: data.nextFollowUpAt,
      },
    });
    await database.outreachDraft.updateMany({
      where: { opportunityId: id, outlookState: { in: [OutlookDraftState.NOT_CREATED, OutlookDraftState.FAILED, OutlookDraftState.NEEDS_REVIEW] }, outlookMessageId: null },
      data: { ...(selectedResumeId ? { attachmentResumeId: selectedResumeId } : {}), status: OutreachDraftStatus.NEEDS_REVIEW, approvedAt: null, validation: outdatedOutreachValidation, outlookState: OutlookDraftState.NEEDS_REVIEW },
    });
    const activityData: Prisma.ActivityCreateManyInput[] = [{
      opportunityId: id,
      type: ActivityType.JOB_UPDATED,
      description: "Opportunity details updated.",
    }];
    if (existing.applicationTrack.currentStage !== data.currentStage) {
      activityData.push({
        opportunityId: id,
        type: ActivityType.STAGE_CHANGED,
        description: `Stage changed from ${existing.applicationTrack.currentStage} to ${data.currentStage}.`,
      });
      const businessEvent = stageActivityType[data.currentStage];
      if (businessEvent) activityData.push({
        opportunityId: id,
        type: businessEvent,
        description: `Recorded automatically from stage ${data.currentStage}.`,
      });
    }
    if (existing.selectedResumeId !== selectedResumeId) activityData.push({
      opportunityId: id,
      type: ActivityType.RESUME_SELECTED,
      description: selectedResumeId ? "Resume updated by deterministic role-family mapping." : "Resume selection cleared after the role family changed.",
    });
    await database.activity.createMany({ data: activityData });
  });

  revalidatePath("/dashboard");
  revalidatePath("/needs-attention");
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${id}`);
  redirect(`/jobs/${id}`);
}

export async function addActivity(id: string, formData: FormData) {
  await requireAuth();
  const description = text(formData, "description", 2000, true)!;
  const type = enumValue(formData.get("type"), Object.values(ActivityType), ActivityType.NOTE);
  const occurredAt = dateTimeValue(formData.get("occurredAt"));

  await getPrisma().activity.create({ data: { opportunityId: id, type, description, occurredAt } });
  revalidatePath("/dashboard");
  revalidatePath("/needs-attention");
  revalidatePath(`/jobs/${id}`);
}

export async function completeAttention(id: string) {
  await requireAuth();
  const completedAt = new Date();
  await getPrisma().$transaction([
    getPrisma().applicationTrack.update({
      where: { opportunityId: id },
      data: { attentionClearedAt: completedAt, nextAction: null, nextFollowUpAt: null },
    }),
    getPrisma().activity.create({
      data: { opportunityId: id, type: ActivityType.NOTE, description: "Attention item completed.", occurredAt: completedAt },
    }),
  ]);
  revalidatePath("/dashboard");
  revalidatePath("/needs-attention");
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${id}`);
  redirect(`/jobs/${id}#attention-actions`);
}

export async function rescheduleAttention(id: string, formData: FormData) {
  await requireAuth();
  const nextFollowUpAt = dateValue(formData.get("nextFollowUpAt"));
  if (!nextFollowUpAt) throw new Error("Next follow-up date is required.");
  const nextAction = text(formData, "nextAction", 500);
  const rescheduledAt = new Date();
  await getPrisma().$transaction([
    getPrisma().applicationTrack.update({
      where: { opportunityId: id },
      data: { attentionClearedAt: rescheduledAt, nextAction, nextFollowUpAt },
    }),
    getPrisma().activity.create({
      data: { opportunityId: id, type: ActivityType.NOTE, description: "Follow-up rescheduled.", occurredAt: rescheduledAt },
    }),
  ]);
  revalidatePath("/dashboard");
  revalidatePath("/needs-attention");
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${id}`);
  redirect(`/jobs/${id}#attention-actions`);
}

async function confirmIntakeRecord(id: string, markDuplicate: boolean, formData: FormData) {
  await requireAuth();
  const opportunity = await getPrisma().$transaction(async (database) => {
    const intake = await database.jobIntake.findUnique({ where: { id } });
    if (!intake || intake.status !== IntakeStatus.PENDING) throw new Error("Intake is not available for confirmation.");
    if (!intake.analysis) throw new Error("The analysis is still running. Confirm once it finishes.");
    const reviewed = readReviewedJobCase(formData, parseJobCase(intake.analysis));
    if ((reviewed.recruiterEmail || reviewed.recruiterPhone) && !reviewed.recruiterName) {
      throw new Error("Recruiter name is required with contact details.");
    }
    // Detected source facts are only proposals until this confirmation records the reviewed values.
    const source = {
      sourceType: enumValue(formData.get("sourceType"), Object.values(JobSourceType), intake.sourceType),
      originalSender: text(formData, "originalSender", 500),
      receivedAt: dateTimeValue(formData.get("receivedAt")),
    };
    const claimed = await database.jobIntake.updateMany({
      where: { id, status: IntakeStatus.PENDING },
      data: { status: IntakeStatus.CONFIRMED, confirmedAt: new Date() },
    });
    if (claimed.count !== 1) throw new Error("Intake was already confirmed.");
    // The profile link is user-entered only; the analyzer never guesses a URL.
    const recruiterLinkedin = profileUrl(text(formData, "recruiterLinkedin", 500));
    if (recruiterLinkedin === false) throw new Error("The recruiter profile link must be a full https:// URL.");
    const contacts = await resolveContacts(database, {
      vendorName: reviewed.vendor,
      recruiterName: reviewed.recruiterName,
      recruiterEmail: reviewed.recruiterEmail,
      recruiterPhone: reviewed.recruiterPhone,
      recruiterLinkedin,
    });

    const preview = parseIntakePreview(intake.preview);
    const chosenResumeId = text(formData, "resumeId", 100) ?? preview?.resumeId ?? null;
    const selectedResumeId = chosenResumeId && await database.resume.count({ where: { id: chosenResumeId, active: true } })
      ? chosenResumeId
      : await automaticResumeId(database, reviewed.roleFamily, reviewed.confidence);

    const created = await database.opportunity.create({
      data: {
        title: reviewed.title,
        client: reviewed.client,
        location: reviewed.location,
        roleFamily: reviewed.roleFamily,
        employmentType: reviewed.employmentType,
        workArrangement: reviewed.workArrangement,
        rawJd: intake.rawText,
        jobCase: reviewed as unknown as Prisma.InputJsonValue,
        jdFingerprint: intake.fingerprint,
        selectedResumeId,
        ...contacts,
        applicationTrack: { create: { currentStage: markDuplicate ? ApplicationStage.DUPLICATE : ApplicationStage.DISCOVERED } },
        activities: {
          create: [
            { type: ActivityType.JOB_CREATED, description: "Opportunity created from confirmed AI intake." },
            { type: ActivityType.JD_RECEIVED, description: `JD confirmed from ${source.sourceType}.` },
            ...(selectedResumeId ? [{ type: ActivityType.RESUME_SELECTED, description: "Resume selected by deterministic role-family mapping." }] : []),
          ],
        },
      },
    });
    await database.jobIntake.update({ where: { id }, data: { opportunityId: created.id, ...source } });

    const draft = readReviewedDraft(formData);
    if (draft && preview?.mode && selectedResumeId) {
      const analyzedMode = enumValue(preview.mode, Object.values(OutreachMode), OutreachMode.FIRST_OUTREACH);
      // A reply must land in a thread the recruiter really sent, so the posted id is confirmed
      // against Graph rather than believed. Failing that, the draft keeps none and says so later.
      let replySourceMessageId: string | null = null;
      const postedSource = text(formData, "replySourceMessageId", 20_000);
      if (postedSource && reviewed.recruiterEmail) {
        try {
          replySourceMessageId = await validateOutlookSourceMessage(postedSource, reviewed.recruiterEmail, { accessToken: await outlookAccessToken() });
        } catch { replySourceMessageId = null; }
      }
      // Choosing a thread is what makes this a reply, even where the paste arrived without the
      // headers that would have said so: the chosen message is confirmed to be from this recruiter,
      // which is the evidence the copied text lost.
      const mode = replySourceMessageId && !replyModes.has(analyzedMode) ? OutreachMode.DIRECT_EMAIL_REPLY : analyzedMode;
      if (replySourceMessageId && mode !== analyzedMode) {
        await database.jobIntake.update({
          where: { id },
          data: {
            sourceType: JobSourceType.DIRECT_EMAIL,
            // The recipient validator looks for the recruiter here, and the verified thread supplies it.
            originalSender: source.originalSender?.includes(reviewed.recruiterEmail!) ? source.originalSender : reviewed.recruiterEmail,
          },
        });
      }
      // The reviewed email carries the pipeline's validation only while the user left it untouched,
      // and only while it is still the kind of email the validator was looking at.
      const untouched = draft.subject === preview.subject && draft.body === preview.body && draft.toAddress === preview.toAddress;
      const approved = untouched && mode === analyzedMode && preview.validation?.status === "PASS";
      await database.outreachDraft.create({
        data: {
          opportunityId: created.id,
          mode,
          replySourceMessageId,
          toAddress: draft.toAddress,
          // A C2C engagement copies the employer by default; it stays visible and clearable on review.
          // The address itself is never model-supplied; the review screen only decides whether to use it.
          ccAddress: formData.get("copyEmployer") === "true" ? employerCcSetting().address : null,
          subject: draft.subject,
          body: draft.body,
          attachmentResumeId: selectedResumeId,
          contextFingerprint: outreachContextFingerprint(await loadOutreachContext()),
          validation: (mode !== analyzedMode
            ? threadChosenValidation
            : untouched && preview.validation ? preview.validation : editedOutreachValidation) as unknown as Prisma.InputJsonValue,
          status: approved ? OutreachDraftStatus.APPROVED : OutreachDraftStatus.NEEDS_REVIEW,
          approvedAt: approved ? new Date() : null,
        },
      });
      await database.activity.createMany({ data: [
        { opportunityId: created.id, type: ActivityType.OUTREACH_DRAFT_GENERATED, description: "Outreach draft prepared during intake and reviewed by the user." },
        ...(approved ? [{ opportunityId: created.id, type: ActivityType.OUTREACH_DRAFT_APPROVED, description: "Outreach draft approved at intake confirmation." }] : []),
      ] });
    }
    return { id: created.id, hasDraft: Boolean(draft && preview?.mode && selectedResumeId) };
  });

  revalidatePath("/dashboard");
  revalidatePath("/needs-attention");
  revalidatePath("/jobs");
  return opportunity;
}

export async function confirmIntake(id: string, markDuplicate: boolean, formData: FormData) {
  const opportunity = await confirmIntakeRecord(id, markDuplicate, formData);
  redirect(opportunity.hasDraft ? `/jobs/${opportunity.id}/outreach` : `/jobs/${opportunity.id}`);
}

/**
 * The whole remaining chain from one click. The review screen shows the recipient, subject, body and
 * attachment and lets the user edit them first, which is the line RESTRICTIONS draws before an
 * external draft exists; nothing is approved that the validator did not pass. The Outlook link is
 * returned rather than redirected to, so the caller can hand it to the tab it already opened.
 */
export async function confirmIntakeWithDraft(id: string, formData: FormData) {
  const opportunity = await confirmIntakeRecord(id, false, formData);
  let url: string | null = null;
  // A refused or drifted draft records its own reason; the outreach page is where that shows.
  if (opportunity.hasDraft) try { url = await buildOutlookDraft(opportunity.id); } catch { url = null; }
  return { url, href: `/jobs/${opportunity.id}/outreach` };
}

export async function updateJobCase(id: string, formData: FormData) {
  await requireAuth();
  await getPrisma().$transaction(async (database) => {
    const job = await database.opportunity.findUnique({ where: { id }, select: { jobCase: true } });
    if (!job?.jobCase) throw new Error("This job has no confirmed JobCase to correct.");
    const original = parseJobCase(job.jobCase);
    const corrected = readJobCaseFacts(formData, original);
    const changes = jobCaseFactChanges(original, corrected);
    if (!changes.length) return;

    await database.opportunity.update({ where: { id }, data: { jobCase: corrected as unknown as Prisma.InputJsonValue } });
    await database.outreachDraft.updateMany({
      where: { opportunityId: id, outlookState: { in: [OutlookDraftState.NOT_CREATED, OutlookDraftState.FAILED, OutlookDraftState.NEEDS_REVIEW] }, outlookMessageId: null },
      data: { status: OutreachDraftStatus.NEEDS_REVIEW, approvedAt: null, validation: outdatedOutreachValidation, outlookState: OutlookDraftState.NEEDS_REVIEW },
    });
    // A corrected fact is a correction of the record, not a silent overwrite of what the analysis said.
    await database.activity.create({
      data: { opportunityId: id, type: ActivityType.CORRECTION, description: `Confirmed JobCase corrected by the user: ${changes.join(", ")}.` },
    });
  });

  revalidatePath(`/jobs/${id}`);
  revalidatePath(`/jobs/${id}/outreach`);
  redirect(`/jobs/${id}#job-case`);
}

export async function selectResume(id: string, resumeId: string) {
  await requireAuth();
  const database = getPrisma();
  const [job, resume] = await Promise.all([
    database.opportunity.findUnique({ where: { id }, select: { id: true, roleFamily: true, jobCase: true, selectedResumeId: true } }),
    database.resume.findUnique({ where: { id: resumeId } }),
  ]);
  if (!job || !resume) throw new Error("Job or resume not found.");
  if (!resume.active || !(await checkResumeFile(resume.filePath)).usable) throw new Error("Only an active, readable resume can be selected.");

  // Picking a resume is the user stating which family this job belongs to. The registry entry supplies
  // the family, so the attachment cross-check downstream still compares two deterministic values.
  const previousRoleFamily = job.roleFamily;
  const roleFamilyChanged = previousRoleFamily !== resume.roleFamily;
  const syncedJobCase = job.jobCase ? { ...parseJobCase(job.jobCase), roleFamily: resume.roleFamily } : null;

  await database.$transaction([
    database.opportunity.update({
      where: { id },
      data: {
        selectedResumeId: resume.id,
        roleFamily: resume.roleFamily,
        ...(syncedJobCase ? { jobCase: syncedJobCase as unknown as Prisma.InputJsonValue } : {}),
      },
    }),
    database.outreachDraft.updateMany({
      where: { opportunityId: id, outlookState: { in: [OutlookDraftState.NOT_CREATED, OutlookDraftState.FAILED, OutlookDraftState.NEEDS_REVIEW] }, outlookMessageId: null },
      data: { attachmentResumeId: resume.id, status: OutreachDraftStatus.NEEDS_REVIEW, approvedAt: null, validation: outdatedOutreachValidation, outlookState: OutlookDraftState.NEEDS_REVIEW },
    }),
    database.activity.createMany({ data: [
      { opportunityId: id, type: ActivityType.RESUME_SELECTED, description: `Resume selected by user review: ${resume.name} ${resume.version}.` },
      // Changing the family rewrites a confirmed fact, so it leaves an explainable record.
      ...(roleFamilyChanged ? [{
        opportunityId: id,
        type: ActivityType.CORRECTION,
        description: `Role family set to ${resume.roleFamily} by choosing that resume${previousRoleFamily ? ` (was ${previousRoleFamily})` : " (was unset)"}.`,
      }] : []),
    ] }),
  ]);
  revalidatePath(`/jobs/${id}`);
  revalidatePath(`/jobs/${id}/outreach`);
  redirect(`/jobs/${id}#resume-router`);
}

export async function deleteJob(id: string) {
  await requireAuth();
  await getPrisma().opportunity.delete({ where: { id } });
  revalidatePath("/dashboard");
  revalidatePath("/needs-attention");
  revalidatePath("/jobs");
  redirect("/jobs");
}
