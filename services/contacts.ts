import type { Prisma } from "@/app/generated/prisma/client";

export type ContactInput = {
  vendorName: string | null;
  recruiterName: string | null;
  recruiterEmail: string | null;
  recruiterPhone: string | null;
};

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
            vendorId,
          },
        })
      : await database.recruiter.create({
          data: { name: data.recruiterName, email: data.recruiterEmail, phone: data.recruiterPhone, vendorId },
        });
    recruiterId = recruiter.id;
  }

  return { recruiterId, vendorId };
}
