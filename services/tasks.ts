import { TaskKind, TaskStatus } from "@/app/generated/prisma/enums";
import { getPrisma } from "@/lib/prisma";

// ponytail: in-process background work matches a single-user local app. The ceiling is the Node
// process: stopping the dev server abandons whatever is running, which the stale sweep then reports.
const STALE_AFTER_MS = 15 * 60 * 1000;

export type TaskHandle = { id: string; progress: (value: string) => Promise<void> };
type TaskRequest = { kind: TaskKind; label: string; subjectId?: string | null; href?: string | null };

export class TaskBusyError extends Error {
  constructor(readonly existingId: string) {
    super("A background task is already running for this item.");
  }
}

function message(error: unknown) {
  return (error instanceof Error ? error.message : "The background task failed.").slice(0, 500);
}

export async function sweepStaleTasks(now = new Date()) {
  const { count } = await getPrisma().task.updateMany({
    where: { status: TaskStatus.RUNNING, startedAt: { lt: new Date(now.getTime() - STALE_AFTER_MS) } },
    data: { status: TaskStatus.FAILED, finishedAt: now, error: "The server stopped before this task finished. Run it again." },
  });
  return count;
}

async function claim(request: TaskRequest) {
  await sweepStaleTasks();
  if (request.subjectId) {
    const running = await getPrisma().task.findFirst({
      where: { subjectId: request.subjectId, kind: request.kind, status: TaskStatus.RUNNING },
      select: { id: true },
    });
    if (running) throw new TaskBusyError(running.id);
  }
  return getPrisma().task.create({
    data: { kind: request.kind, label: request.label, subjectId: request.subjectId ?? null, href: request.href ?? null },
    select: { id: true },
  });
}

async function execute(id: string, work: (task: TaskHandle) => Promise<void>) {
  const handle: TaskHandle = {
    id,
    progress: async (value) => { await getPrisma().task.update({ where: { id }, data: { progress: value.slice(0, 100) } }); },
  };
  try {
    await work(handle);
    await getPrisma().task.update({ where: { id }, data: { status: TaskStatus.DONE, finishedAt: new Date(), progress: null } });
  } catch (error) {
    await getPrisma().task.update({ where: { id }, data: { status: TaskStatus.FAILED, finishedAt: new Date(), error: message(error) } });
  }
}

/** Records the task and returns at once; `defer` hands the work to the runtime after the response. */
export async function startTask(
  request: TaskRequest,
  work: (task: TaskHandle) => Promise<void>,
  defer: (run: () => Promise<void>) => void,
) {
  const task = await claim(request);
  defer(() => execute(task.id, work));
  return task.id;
}

/** Runs the task to completion in the caller. Used where no request exists, such as the scheduler. */
export async function runTaskNow(request: TaskRequest, work: (task: TaskHandle) => Promise<void>) {
  const task = await claim(request);
  await execute(task.id, work);
  return task.id;
}
