"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  ActivityType,
  ApplicationStage,
  EmploymentType,
  IntakeStatus,
  OutlookDraftState,
  OutreachDraftStatus,
  RoleFamily,
  WorkArrangement,
} from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";
import { requireAuth } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { jobFingerprint, parseJobCase, readReviewedJobCase } from "@/services/job-case";
import { buildResumeRoute, checkResumeFile } from "@/services/resume-router";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const outdatedOutreachValidation = {
  status: "NEEDS_REVIEW",
  issues: [{ field: "source", severity: "BLOCK", message: "Job or Resume data changed; validate the outreach draft again." }],
} satisfies Prisma.InputJsonValue;
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

function dateValue(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid date.");
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("Invalid date.");
  return date;
}

function dateTimeValue(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value) return new Date();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Invalid date and time.");
  const date = new Date(`${value}:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 16) !== value) throw new Error("Invalid date and time.");
  return date;
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

async function resolveContacts(
  database: Prisma.TransactionClient,
  data: ReturnType<typeof readJob>,
  currentRecruiterId?: string | null,
) {
  let vendorId: string | null = null;
  if (data.vendorName) {
    const existing = await database.vendor.findFirst({
      where: { name: { equals: data.vendorName, mode: "insensitive" } },
    });
    vendorId = existing?.id ?? (await database.vendor.create({ data: { name: data.vendorName } })).id;
  }

  let recruiterId: string | null = null;
  if (data.recruiterName) {
    const existing = data.recruiterEmail
      ? await database.recruiter.findFirst({
          where: { email: { equals: data.recruiterEmail, mode: "insensitive" } },
        })
      : currentRecruiterId
        ? await database.recruiter.findUnique({ where: { id: currentRecruiterId } })
        : null;
    const recruiter = existing
      ? await database.recruiter.update({
          where: { id: existing.id },
          data: { name: data.recruiterName, email: data.recruiterEmail, phone: data.recruiterPhone, vendorId },
        })
      : await database.recruiter.create({
          data: { name: data.recruiterName, email: data.recruiterEmail, phone: data.recruiterPhone, vendorId },
        });
    recruiterId = recruiter.id;
  }

  return { recruiterId, vendorId };
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
      data: { status: OutreachDraftStatus.NEEDS_REVIEW, approvedAt: null, validation: outdatedOutreachValidation, outlookState: OutlookDraftState.NEEDS_REVIEW },
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

export async function confirmIntake(id: string, markDuplicate: boolean, formData: FormData) {
  await requireAuth();
  const opportunity = await getPrisma().$transaction(async (database) => {
    const intake = await database.jobIntake.findUnique({ where: { id } });
    if (!intake || intake.status !== IntakeStatus.PENDING) throw new Error("Intake is not available for confirmation.");
    const reviewed = readReviewedJobCase(formData, parseJobCase(intake.analysis));
    if ((reviewed.recruiterEmail || reviewed.recruiterPhone) && !reviewed.recruiterName) {
      throw new Error("Recruiter name is required with contact details.");
    }
    const claimed = await database.jobIntake.updateMany({
      where: { id, status: IntakeStatus.PENDING },
      data: { status: IntakeStatus.CONFIRMED, confirmedAt: new Date() },
    });
    if (claimed.count !== 1) throw new Error("Intake was already confirmed.");
    const contacts = await resolveContacts(database, {
      title: reviewed.title,
      client: reviewed.client,
      location: reviewed.location,
      roleFamily: reviewed.roleFamily,
      employmentType: reviewed.employmentType,
      workArrangement: reviewed.workArrangement,
      rawJd: intake.rawText,
      vendorName: reviewed.vendor,
      recruiterName: reviewed.recruiterName,
      recruiterEmail: reviewed.recruiterEmail,
      recruiterPhone: reviewed.recruiterPhone,
      currentStage: markDuplicate ? ApplicationStage.DUPLICATE : ApplicationStage.DISCOVERED,
      waitingOn: null,
      nextAction: null,
      nextFollowUpAt: null,
    });
    const selectedResumeId = await automaticResumeId(database, reviewed.roleFamily, reviewed.confidence);
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
            { type: ActivityType.JD_RECEIVED, description: `JD confirmed from ${intake.sourceType}.` },
            ...(selectedResumeId ? [{ type: ActivityType.RESUME_SELECTED, description: "Resume selected by deterministic role-family mapping." }] : []),
          ],
        },
      },
    });
    await database.jobIntake.update({ where: { id }, data: { opportunityId: created.id } });
    return created;
  });

  revalidatePath("/dashboard");
  revalidatePath("/needs-attention");
  revalidatePath("/jobs");
  redirect(`/jobs/${opportunity.id}`);
}

export async function selectResume(id: string, resumeId: string) {
  await requireAuth();
  const database = getPrisma();
  const [job, resume] = await Promise.all([
    database.opportunity.findUnique({ where: { id }, select: { id: true, roleFamily: true } }),
    database.resume.findUnique({ where: { id: resumeId } }),
  ]);
  if (!job || !resume) throw new Error("Job or resume not found.");
  if (!job.roleFamily) throw new Error("Confirm the job role family before selecting a resume.");
  if (!resume.active || !(await checkResumeFile(resume.filePath)).usable) throw new Error("Only an active, readable resume can be selected.");

  await database.$transaction([
    database.opportunity.update({ where: { id }, data: { selectedResumeId: resume.id } }),
    database.outreachDraft.updateMany({
      where: { opportunityId: id, outlookState: { in: [OutlookDraftState.NOT_CREATED, OutlookDraftState.FAILED, OutlookDraftState.NEEDS_REVIEW] }, outlookMessageId: null },
      data: { status: OutreachDraftStatus.NEEDS_REVIEW, approvedAt: null, validation: outdatedOutreachValidation, outlookState: OutlookDraftState.NEEDS_REVIEW },
    }),
    database.activity.create({ data: { opportunityId: id, type: ActivityType.RESUME_SELECTED, description: "Resume selected by user review." } }),
  ]);
  revalidatePath(`/jobs/${id}`);
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
