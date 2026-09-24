import { TaskKind } from "@/app/generated/prisma/enums";
import { getPrisma } from "@/lib/prisma";
import { detectIntakeSource } from "@/services/intake-source";
import { runIntakePipeline } from "@/services/intake-pipeline";
import { jobFingerprint } from "@/services/job-case";
import { startTask } from "@/services/tasks";

/**
 * Records a pasted source and starts its pipeline behind the response. The paste box and the LinkedIn
 * bookmarklet both come through here. The source facts are derived from the text, never supplied by
 * the caller, and stay correctable on review.
 */
export async function startPastedIntake(rawText: string, label: string, defer: (run: () => Promise<void>) => void) {
  const { sourceType, originalSender, receivedAt } = detectIntakeSource(rawText);
  const intake = await getPrisma().jobIntake.create({
    data: { sourceType, rawText, originalSender, receivedAt, fingerprint: jobFingerprint(rawText) },
    select: { id: true },
  });
  // Analysis, resume routing, drafting and validation all run after the response, so nobody waits.
  await startTask(
    { kind: TaskKind.INTAKE_PIPELINE, label, subjectId: intake.id, href: `/intakes/${intake.id}/review` },
    (task) => runIntakePipeline(intake.id, task),
    defer,
  );
  return intake.id;
}
