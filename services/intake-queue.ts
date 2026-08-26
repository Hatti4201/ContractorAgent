import type { Prisma } from "@/app/generated/prisma/client";
import { IntakeStatus, TaskStatus } from "@/app/generated/prisma/enums";
import { getPrisma } from "@/lib/prisma";
import { parseIntakePreview } from "@/services/intake-pipeline";

export type QueuedIntake = {
  id: string;
  createdAt: Date;
  sourceType: string;
  title: string;
  recruiterName: string | null;
  state: "ANALYZING" | "READY" | "STOPPED" | "FAILED";
  detail: string | null;
};

/**
 * Pending intakes are the only records the pipeline leaves behind before anything is confirmed. They
 * had no listing anywhere, so an intake became unreachable once its task notice expired.
 */
export async function queuedIntakes(database: Prisma.TransactionClient = getPrisma()): Promise<QueuedIntake[]> {
  const intakes = await database.jobIntake.findMany({
    where: { status: IntakeStatus.PENDING },
    // Oldest first: the queue is work to clear, not a feed.
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  if (!intakes.length) return [];

  const failed = new Set((await database.task.findMany({
    where: { subjectId: { in: intakes.map((intake) => intake.id) }, status: TaskStatus.FAILED },
    select: { subjectId: true },
  })).flatMap((task) => (task.subjectId ? [task.subjectId] : [])));

  return intakes.map((intake) => {
    const analysis = intake.analysis as { title?: string | null; recruiterName?: string | null } | null;
    const preview = parseIntakePreview(intake.preview);
    const title = analysis?.title?.slice(0, 120) || intake.rawText.trim().split("\n")[0]?.slice(0, 120) || "Untitled source";
    const recruiterName = analysis?.recruiterName?.slice(0, 120) || null;
    if (!intake.analysis) {
      return { id: intake.id, createdAt: intake.createdAt, sourceType: intake.sourceType, title, recruiterName,
        state: failed.has(intake.id) ? "FAILED" : "ANALYZING",
        detail: failed.has(intake.id) ? "Analysis did not finish. Open it to try again." : null } as const;
    }
    if (preview?.brake) {
      return { id: intake.id, createdAt: intake.createdAt, sourceType: intake.sourceType, title, recruiterName, state: "STOPPED", detail: preview.brake } as const;
    }
    return { id: intake.id, createdAt: intake.createdAt, sourceType: intake.sourceType, title, recruiterName, state: "READY", detail: null } as const;
  });
}

export function countQueuedIntakes(database: Prisma.TransactionClient = getPrisma()) {
  return database.jobIntake.count({ where: { status: IntakeStatus.PENDING } });
}
