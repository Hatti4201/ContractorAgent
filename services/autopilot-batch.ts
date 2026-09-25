import { IntakeStatus, TaskKind } from "@/app/generated/prisma/enums";
import { pooled } from "@/lib/pooled";
import { getPrisma } from "@/lib/prisma";
import { autopilotApplies, readyForAutopilot } from "@/services/autopilot";
import { currentAutopilotMode } from "@/services/auto-send";
import { parseIntakePreview, resumeAutopilot } from "@/services/intake-pipeline";
import { startTask } from "@/services/tasks";

// Each job is an Outlook draft upload, not a model call; a few at a time keep Graph comfortable.
const CONCURRENCY = 3;

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
  return intakes.filter((intake) => readyForAutopilot(parseIntakePreview(intake.preview))).map((intake) => intake.id);
}

/** Runs the autopilot over every waiting job in the background; returns how many it took on. */
export async function startAutopilotOnWaiting(defer: (run: () => Promise<void>) => void) {
  if (!autopilotApplies(await currentAutopilotMode())) return 0;
  const ids = await waitingForAutopilot();
  if (!ids.length) return 0;
  await startTask(
    { kind: TaskKind.AUTOPILOT_BATCH, label: `Running the autopilot on ${ids.length} waiting job${ids.length === 1 ? "" : "s"}`, subjectId: "autopilot-batch", href: "/dashboard#autopilot" },
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
