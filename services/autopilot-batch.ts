import { IntakeStatus, TaskKind } from "@/app/generated/prisma/enums";
import { pooled } from "@/lib/pooled";
import { getPrisma } from "@/lib/prisma";
import { autopilotApplies, readyForAutopilot } from "@/services/autopilot";
import { currentAutopilotMode } from "@/services/auto-send";
import { parseIntakePreview, resumeAutopilot } from "@/services/intake-pipeline";
import { inferJobTitle, parseJobCase } from "@/services/job-case";
import { startTask, TaskBusyError } from "@/services/tasks";

// Each job is an Outlook draft upload, not a model call; a few at a time keep Graph comfortable.
const CONCURRENCY = 3;
const titleHold = "The analysis found no job title.";

/**
 * Jobs with a finished email still waiting in the queue: prepared while the autopilot was off, or
 * held by it before something changed. Oldest first, like the queue.
 */
export async function waitingForAutopilot() {
  const intakes = await getPrisma().jobIntake.findMany({
    where: { status: IntakeStatus.PENDING },
    select: { id: true, preview: true },
    orderBy: { createdAt: "asc" },
  });
  return intakes.filter((intake) => {
    const preview = parseIntakePreview(intake.preview);
    return readyForAutopilot(preview) && (!preview?.hold || preview.hold === titleHold);
  }).map((intake) => intake.id);
}

/** Finished drafts that need a person, with the exact hold/brake shown in the intake review. */
export async function manualAutopilotQueue() {
  const intakes = await getPrisma().jobIntake.findMany({
    where: { status: IntakeStatus.PENDING },
    select: { id: true, rawText: true, analysis: true, preview: true },
    orderBy: { createdAt: "asc" },
  });
  return intakes.flatMap((intake) => {
    const preview = parseIntakePreview(intake.preview);
    const reason = preview?.hold ?? preview?.brake ?? "The intake needs review before the autopilot can continue.";
    if (!preview || reason === titleHold) return [];
    const analysis = intake.analysis ? parseJobCase(intake.analysis) : null;
    const title = inferJobTitle(intake.rawText, analysis?.roleFamily ?? null);
    return [{ id: intake.id, title, reason, href: `/intakes/${intake.id}/review` }];
  });
}

/** Runs the autopilot over every waiting job in the background; returns how many it took on. */
export async function startAutopilotOnWaiting(defer: (run: () => Promise<void>) => void) {
  if (!autopilotApplies(await currentAutopilotMode())) return 0;
  const ids = await waitingForAutopilot();
  if (!ids.length) return 0;
  await startTask(
    { kind: TaskKind.AUTOPILOT_BATCH, label: `Running the autopilot on ${ids.length} waiting job${ids.length === 1 ? "" : "s"}`, subjectId: "autopilot-batch", href: "/autopilot" },
    async (task) => {
      let done = 0;
      await pooled(ids, CONCURRENCY, async (id) => {
        // One job's failure is recorded on that job; the rest carry on.
        try { await resumeAutopilot(id); } catch { /* left in the queue as it was */ }
        done += 1;
        await task.progress(`${done} of ${ids.length} done`);
      });
    },
    defer,
  );
  return ids.length;
}

/**
 * The same, after the switch or the threshold moved: what waited under the old setting may pass now,
 * so it goes without a second click. -1 when a batch is already running, which covers these jobs too.
 */
export async function rerunWaiting(defer: (run: () => Promise<void>) => void) {
  try {
    return await startAutopilotOnWaiting(defer);
  } catch (error) {
    if (error instanceof TaskBusyError) return -1;
    throw error;
  }
}
