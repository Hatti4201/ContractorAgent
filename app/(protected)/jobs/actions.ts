"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  ActivityType,
  ApplicationStage,
  EmploymentType,
  WorkArrangement,
} from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";
import { requireAuth } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export async function createJob(formData: FormData) {
  await requireAuth();
  const data = readJob(formData);

  const opportunity = await getPrisma().$transaction(async (database) => {
    const contacts = await resolveContacts(database, data);
    return database.opportunity.create({
      data: {
        title: data.title,
        client: data.client,
        location: data.location,
        employmentType: data.employmentType,
        workArrangement: data.workArrangement,
        rawJd: data.rawJd,
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
          create: { type: ActivityType.JOB_CREATED, description: "Opportunity created manually." },
        },
      },
    });
  });

  revalidatePath("/dashboard");
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
    await database.opportunity.update({
      where: { id },
      data: {
        title: data.title,
        client: data.client,
        location: data.location,
        employmentType: data.employmentType,
        workArrangement: data.workArrangement,
        rawJd: data.rawJd,
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
    await database.activity.create({
      data: { opportunityId: id, type: ActivityType.JOB_UPDATED, description: "Opportunity details updated." },
    });
    if (existing.applicationTrack.currentStage !== data.currentStage) {
      await database.activity.create({
        data: {
          opportunityId: id,
          type: ActivityType.STAGE_CHANGED,
          description: `Stage changed from ${existing.applicationTrack.currentStage} to ${data.currentStage}.`,
        },
      });
    }
  });

  revalidatePath("/dashboard");
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
  revalidatePath(`/jobs/${id}`);
}

export async function deleteJob(id: string) {
  await requireAuth();
  await getPrisma().opportunity.delete({ where: { id } });
  revalidatePath("/dashboard");
  revalidatePath("/jobs");
  redirect("/jobs");
}
