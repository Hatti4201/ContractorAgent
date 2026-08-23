import { ActivityType } from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";

export type MergeableRecruiter = {
  name: string;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  notes: string | null;
  vendorId: string | null;
};

const NOTES_LIMIT = 2000;

const same = (left: string | null, right: string | null) =>
  Boolean(left && right && left.trim().toLowerCase() === right.trim().toLowerCase());

// Merging keeps every value the target already holds and only fills its gaps. Anything the target
// cannot absorb is written into its notes, because a merge is a correction, not a deletion.
export function mergedRecruiterFields(source: MergeableRecruiter, target: MergeableRecruiter) {
  const dropped = ([
    ["email", source.email, target.email],
    ["phone", source.phone, target.phone],
    ["profile", source.linkedinUrl, target.linkedinUrl],
  ] as const).flatMap(([label, from, held]) => (from && held && !same(from, held) ? [`${label}: ${from}`] : []));

  const carried = [
    dropped.length ? `also reachable at ${dropped.join("; ")}` : null,
    source.notes,
  ].filter(Boolean).join("\n");
  const note = carried ? `Merged from "${source.name}"\n${carried}` : null;

  return {
    email: target.email ?? source.email,
    phone: target.phone ?? source.phone,
    linkedinUrl: target.linkedinUrl ?? source.linkedinUrl,
    vendorId: target.vendorId ?? source.vendorId,
    notes: note ? [target.notes, note].filter(Boolean).join("\n\n").slice(0, NOTES_LIMIT) : target.notes,
  };
}

export async function mergeRecruiterRecords(
  database: Prisma.TransactionClient,
  sourceId: string,
  targetId: string,
) {
  const [source, target] = await Promise.all([
    database.recruiter.findUnique({ where: { id: sourceId } }),
    database.recruiter.findUnique({ where: { id: targetId } }),
  ]);
  if (!source || !target || source.id === target.id) throw new Error("Merging needs two different existing recruiters.");

  const moved = await database.opportunity.findMany({ where: { recruiterId: source.id }, select: { id: true } });
  await database.recruiter.update({ where: { id: target.id }, data: mergedRecruiterFields(source, target) });
  await database.opportunity.updateMany({ where: { recruiterId: source.id }, data: { recruiterId: target.id } });
  // Merging rewrites who a job belongs to, so each moved job keeps an explainable correction record.
  if (moved.length) await database.activity.createMany({
    data: moved.map((job): Prisma.ActivityCreateManyInput => ({
      opportunityId: job.id,
      type: ActivityType.CORRECTION,
      description: `Recruiter merged from "${source.name}" into "${target.name}".`,
    })),
  });
  await database.recruiter.delete({ where: { id: source.id } });
  return moved.length;
}
