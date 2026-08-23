"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { resolveVendorId } from "@/services/contacts";
import { mergeRecruiterRecords } from "@/services/recruiter-merge";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(formData: FormData, name: string, maximum: number) {
  const value = formData.get(name);
  const cleaned = typeof value === "string" ? value.trim() : "";
  return cleaned && cleaned.length <= maximum ? cleaned : null;
}

function profileUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : false;
  } catch {
    return false;
  }
}

function readRecruiter(formData: FormData) {
  const name = text(formData, "name", 200);
  const email = text(formData, "email", 320);
  const linkedinUrl = profileUrl(text(formData, "linkedinUrl", 500));
  if (!name || (email && !emailPattern.test(email))) return { error: "fields" as const };
  if (linkedinUrl === false) return { error: "linkedin" as const };
  return {
    error: null,
    value: {
      name,
      email,
      linkedinUrl,
      phone: text(formData, "phone", 80),
      notes: text(formData, "notes", 2000),
      vendorName: text(formData, "vendorName", 200),
    },
  };
}

async function emailTaken(email: string, exceptId?: string) {
  return Boolean(await getPrisma().recruiter.count({
    where: { ...(exceptId ? { id: { not: exceptId } } : {}), email: { equals: email, mode: "insensitive" } },
  }));
}

export async function createRecruiter(formData: FormData) {
  await requireAuth();
  const parsed = readRecruiter(formData);
  if (parsed.error) redirect(`/recruiters?error=${parsed.error}`);
  const { vendorName, ...input } = parsed.value;
  if (input.email && await emailTaken(input.email)) redirect("/recruiters?error=email-taken");

  const created = await getPrisma().$transaction(async (transaction) => transaction.recruiter.create({
    data: { ...input, vendorId: await resolveVendorId(transaction, vendorName) },
    select: { id: true },
  }));

  revalidatePath("/recruiters");
  redirect(`/recruiters/${created.id}?saved=1`);
}

export async function updateRecruiter(id: string, formData: FormData) {
  await requireAuth();
  const parsed = readRecruiter(formData);
  if (parsed.error) redirect(`/recruiters/${id}?edit=1&error=${parsed.error}`);
  const { vendorName, ...input } = parsed.value;

  const database = getPrisma();
  if (!await database.recruiter.count({ where: { id } })) redirect("/recruiters?error=missing");
  // One email must stay one recruiter, or the directory splits the same person again.
  if (input.email && await emailTaken(input.email, id)) redirect(`/recruiters/${id}?edit=1&error=email-taken`);

  await database.$transaction(async (transaction) => {
    await transaction.recruiter.update({
      where: { id },
      data: { ...input, vendorId: await resolveVendorId(transaction, vendorName) },
    });
  });

  revalidatePath("/recruiters");
  revalidatePath(`/recruiters/${id}`);
  revalidatePath("/jobs");
  redirect(`/recruiters/${id}?saved=1`);
}

export async function deleteRecruiter(id: string) {
  await requireAuth();
  const database = getPrisma();
  const recruiter = await database.recruiter.findUnique({ where: { id }, select: { id: true } });
  if (!recruiter) redirect("/recruiters?error=missing");
  // Opportunity.recruiter is SetNull, so an unguarded delete would silently orphan the job history.
  if (await database.opportunity.count({ where: { recruiterId: id } })) redirect(`/recruiters/${id}?error=in-use`);

  await database.recruiter.delete({ where: { id } });
  revalidatePath("/recruiters");
  redirect("/recruiters?deleted=1");
}

export async function mergeRecruiter(id: string, formData: FormData) {
  await requireAuth();
  const targetId = formData.get("targetId");
  if (typeof targetId !== "string" || !targetId || targetId === id) redirect(`/recruiters/${id}?error=merge-target`);

  try {
    await getPrisma().$transaction((transaction) => mergeRecruiterRecords(transaction, id, targetId));
  } catch {
    redirect(`/recruiters/${id}?error=merge-failed`);
  }

  revalidatePath("/recruiters");
  revalidatePath("/jobs");
  redirect(`/recruiters/${targetId}?saved=1`);
}
