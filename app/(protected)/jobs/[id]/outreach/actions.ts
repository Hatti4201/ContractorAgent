"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ActivityType, OutlookDraftState, OutreachDraftStatus, OutreachMode } from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";
import { requireAuth } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { parseJobCase } from "@/services/job-case";
import { loadOutreachContext, outreachContextFingerprint } from "@/services/outreach-context";
import {
  determineOutreachMode,
  generateOutreachContent,
  outreachBlockingIssues,
  validateOutreachContent,
  type OutreachContent,
  type OutreachInput,
} from "@/services/outreach-agent";

const lockedOutlookStates = new Set<OutlookDraftState>([OutlookDraftState.CREATING, OutlookDraftState.CREATED, OutlookDraftState.SENT]);

function text(formData: FormData, name: string, maximum: number) {
  const value = formData.get(name);
  const cleaned = typeof value === "string" ? value.trim() : "";
  if (!cleaned || cleaned.length > maximum) throw new Error(`${name} is missing or too long.`);
  return cleaned;
}

async function outreachInput(id: string, modeOverride?: OutreachMode): Promise<OutreachInput> {
  const job = await getPrisma().opportunity.findUnique({
    where: { id },
    include: {
      recruiter: true,
      selectedResume: true,
      intake: true,
      activities: { orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }], take: 10 },
    },
  });
  if (!job?.jobCase) throw new Error("A confirmed JobCase is required before preparing outreach.");
  if (!job.recruiter?.email) throw new Error("A confirmed recruiter email is required before preparing outreach.");
  if (!job.selectedResume) throw new Error("Select a Resume before preparing outreach.");
  const jobCase = parseJobCase(job.jobCase);
  const activityTypes = job.activities.map((activity) => activity.type);
  const sourceType = job.intake?.sourceType ?? null;

  return {
    mode: modeOverride ?? determineOutreachMode(sourceType, activityTypes),
    toAddress: job.recruiter.email,
    recruiterName: job.recruiter.name,
    jobCase,
    resume: job.selectedResume,
    source: {
      sourceType,
      originalSender: job.intake?.originalSender ?? null,
      rawText: job.intake?.rawText ?? job.rawJd ?? "",
    },
    activityTypes,
    activitySummary: job.activities.map((activity) => `${activity.type}: ${activity.description.slice(0, 500)}`),
    approvedContext: await loadOutreachContext(),
  };
}

function draftStatus(validation: Awaited<ReturnType<typeof validateOutreachContent>>) {
  return validation.status === "PASS" ? OutreachDraftStatus.DRAFT : OutreachDraftStatus.NEEDS_REVIEW;
}

function selectedMode(formData: FormData) {
  const value = formData.get("mode");
  if (typeof value !== "string" || !Object.values(OutreachMode).includes(value as OutreachMode)) throw new Error("Select a valid outreach mode.");
  return value as OutreachMode;
}

async function requireMutableDraft(id: string) {
  const draft = await getPrisma().outreachDraft.findUnique({ where: { opportunityId: id }, select: { outlookState: true, outlookMessageId: true } });
  if (draft && (lockedOutlookStates.has(draft.outlookState) || draft.outlookMessageId)) {
    throw new Error("The outreach content is locked after Outlook draft creation.");
  }
}

async function saveGeneratedDraft(id: string, input: OutreachInput, content: OutreachContent) {
  const validation = await validateOutreachContent(input, content);
  await getPrisma().$transaction([
    getPrisma().outreachDraft.upsert({
      where: { opportunityId: id },
      create: {
        opportunityId: id,
        mode: input.mode,
        toAddress: input.toAddress,
        subject: content.subject,
        body: content.body,
        attachmentResumeId: input.resume.id,
        contextFingerprint: outreachContextFingerprint(input.approvedContext),
        validation: validation as unknown as Prisma.InputJsonValue,
        status: draftStatus(validation),
      },
      update: {
        mode: input.mode,
        toAddress: input.toAddress,
        subject: content.subject,
        body: content.body,
        attachmentResumeId: input.resume.id,
        contextFingerprint: outreachContextFingerprint(input.approvedContext),
        validation: validation as unknown as Prisma.InputJsonValue,
        status: draftStatus(validation),
        approvedAt: null,
        revision: { increment: 1 },
        outlookState: OutlookDraftState.NOT_CREATED,
        outlookMessageId: null,
        outlookWebLink: null,
        outlookError: null,
        outlookDraftRevision: null,
        outlookDraftCreatedAt: null,
        sentConfirmedAt: null,
        replySourceMessageId: null,
      },
    }),
    getPrisma().activity.create({
      data: { opportunityId: id, type: ActivityType.OUTREACH_DRAFT_GENERATED, description: "Outreach draft generated and validated for user review." },
    }),
  ]);
}

export async function generateOutreachDraft(id: string) {
  await requireAuth();
  try {
    await requireMutableDraft(id);
    const input = await outreachInput(id);
    const blockers = await outreachBlockingIssues(input);
    if (blockers.length) throw new Error(blockers[0]!.message);
    await saveGeneratedDraft(id, input, await generateOutreachContent(input));
  } catch (error) {
    const configuration = error instanceof Error && (error.message === "OPENAI_API_KEY is not configured." || /private/i.test(error.message));
    redirect(`/jobs/${id}?outreachError=${configuration ? "configuration" : "failed"}`);
  }
  revalidatePath(`/jobs/${id}`);
  redirect(`/jobs/${id}/outreach`);
}

export async function saveOutreachDraft(id: string, formData: FormData) {
  await requireAuth();
  await requireMutableDraft(id);
  const input = await outreachInput(id, selectedMode(formData));
  input.toAddress = text(formData, "toAddress", 320);
  const content = { subject: text(formData, "subject", 300), body: text(formData, "body", 10_000) };
  const validation = await validateOutreachContent(input, content);
  await getPrisma().$transaction([
    getPrisma().outreachDraft.update({
      where: { opportunityId: id },
      data: {
        mode: input.mode,
        toAddress: input.toAddress,
        subject: content.subject,
        body: content.body,
        attachmentResumeId: input.resume.id,
        contextFingerprint: outreachContextFingerprint(input.approvedContext),
        validation: validation as unknown as Prisma.InputJsonValue,
        status: draftStatus(validation),
        approvedAt: null,
        revision: { increment: 1 },
        outlookState: OutlookDraftState.NOT_CREATED,
        outlookMessageId: null,
        outlookWebLink: null,
        outlookError: null,
        outlookDraftRevision: null,
        outlookDraftCreatedAt: null,
        sentConfirmedAt: null,
        replySourceMessageId: null,
      },
    }),
    getPrisma().activity.create({
      data: { opportunityId: id, type: ActivityType.OUTREACH_DRAFT_EDITED, description: "Outreach draft edited and revalidated by the user." },
    }),
  ]);
  revalidatePath(`/jobs/${id}`);
  revalidatePath(`/jobs/${id}/outreach`);
  redirect(`/jobs/${id}/outreach`);
}

export async function approveOutreachDraft(id: string, formData: FormData) {
  await requireAuth();
  await requireMutableDraft(id);
  const draft = await getPrisma().outreachDraft.findUnique({ where: { opportunityId: id } });
  if (!draft) throw new Error("Outreach draft not found.");
  const input = await outreachInput(id, draft.mode);
  input.toAddress = draft.toAddress;
  const validation = draft.attachmentResumeId === input.resume.id
    ? await validateOutreachContent(input, { subject: draft.subject, body: draft.body })
    : { status: "NEEDS_REVIEW" as const, issues: [{ field: "attachment", severity: "BLOCK" as const, message: "Draft attachment no longer matches the selected Resume." }] };
  const overrideWarnings = formData.get("overrideWarnings") === "true";
  const approved = validation.status === "PASS" || overrideWarnings;
  await getPrisma().$transaction(async (database) => {
    await database.outreachDraft.update({
      where: { opportunityId: id },
      data: {
        validation: validation as unknown as Prisma.InputJsonValue,
        contextFingerprint: outreachContextFingerprint(input.approvedContext),
        status: approved ? OutreachDraftStatus.APPROVED : OutreachDraftStatus.NEEDS_REVIEW,
        approvedAt: approved ? new Date() : null,
        outlookState: approved ? OutlookDraftState.NOT_CREATED : OutlookDraftState.NEEDS_REVIEW,
        outlookError: approved && validation.status !== "PASS" ? "Approved with validator warnings; review carefully before sending." : approved ? null : "Outreach validation failed; review the draft before Outlook creation.",
      },
    });
    if (approved) await database.activity.create({
      data: { opportunityId: id, type: ActivityType.OUTREACH_DRAFT_APPROVED, description: "Outreach draft approved for later external draft creation." },
    });
  });
  revalidatePath(`/jobs/${id}`);
  revalidatePath(`/jobs/${id}/outreach`);
  redirect(`/jobs/${id}/outreach`);
}
