import type { Prisma } from "@/app/generated/prisma/client";

export type ContactInput = {
  vendorName: string | null;
  recruiterName: string | null;
  recruiterEmail: string | null;
  recruiterPhone: string | null;
  recruiterLinkedin?: string | null;
};

/** Returns false for anything that is not an https URL, so the caller can report it instead of storing junk. */
export function profileUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : false;
  } catch {
    return false;
  }
}

export async function resolveVendorId(database: Prisma.TransactionClient, vendorName: string | null) {
  if (!vendorName) return null;
  const existing = await database.vendor.findFirst({
    where: { name: { equals: vendorName, mode: "insensitive" } },
  });
  return existing?.id ?? (await database.vendor.create({ data: { name: vendorName } })).id;
}

export async function resolveContacts(
  database: Prisma.TransactionClient,
  data: ContactInput,
  currentRecruiterId?: string | null,
) {
  const vendorId = await resolveVendorId(database, data.vendorName);

  let recruiterId: string | null = null;
  if (data.recruiterName) {
    // ponytail: email is the strongest identity; without one, name + vendor keeps repeat jobs on a single recruiter row.
    const byName = !data.recruiterEmail && !currentRecruiterId;
    const existing = data.recruiterEmail
      ? await database.recruiter.findFirst({
          where: { email: { equals: data.recruiterEmail, mode: "insensitive" } },
        })
      : currentRecruiterId
        ? await database.recruiter.findUnique({ where: { id: currentRecruiterId } })
        : await database.recruiter.findFirst({
            where: { name: { equals: data.recruiterName, mode: "insensitive" }, vendorId },
          });
    const recruiter = existing
      ? await database.recruiter.update({
          where: { id: existing.id },
          // A name-only match must never clear contact details the matched record already holds.
          data: {
            name: data.recruiterName,
            email: byName ? existing.email : data.recruiterEmail,
            phone: byName ? data.recruiterPhone ?? existing.phone : data.recruiterPhone,
            // Only the recruiter page can clear a profile link; a job form that never showed it must not.
            linkedinUrl: data.recruiterLinkedin ?? existing.linkedinUrl,
            vendorId,
          },
        })
      : await database.recruiter.create({
          data: { name: data.recruiterName, email: data.recruiterEmail, phone: data.recruiterPhone, linkedinUrl: data.recruiterLinkedin ?? null, vendorId },
        });
    recruiterId = recruiter.id;
  }

  return { recruiterId, vendorId };
}
