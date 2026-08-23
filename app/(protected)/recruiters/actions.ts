"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { resolveVendorId } from "@/services/contacts";

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

export async function updateRecruiter(id: string, formData: FormData) {
  await requireAuth();
  const name = text(formData, "name", 200);
  const email = text(formData, "email", 320);
  const linkedinUrl = profileUrl(text(formData, "linkedinUrl", 500));
  if (!name || (email && !emailPattern.test(email))) redirect(`/recruiters/${id}?error=fields`);
  if (linkedinUrl === false) redirect(`/recruiters/${id}?error=linkedin`);

  const database = getPrisma();
  const recruiter = await database.recruiter.findUnique({ where: { id }, select: { id: true } });
  if (!recruiter) redirect("/recruiters?error=missing");
  // One email must stay one recruiter, or the directory splits the same person again.
  if (email && await database.recruiter.count({ where: { id: { not: id }, email: { equals: email, mode: "insensitive" } } })) {
    redirect(`/recruiters/${id}?error=email-taken`);
  }

  await database.$transaction(async (transaction) => {
    await transaction.recruiter.update({
      where: { id },
      data: {
        name,
        email,
        phone: text(formData, "phone", 80),
        linkedinUrl,
        notes: text(formData, "notes", 2000),
        vendorId: await resolveVendorId(transaction, text(formData, "vendorName", 200)),
      },
    });
  });

  revalidatePath("/recruiters");
  revalidatePath(`/recruiters/${id}`);
  revalidatePath("/jobs");
  redirect(`/recruiters/${id}?saved=1`);
}
