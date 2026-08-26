import "dotenv/config";
import assert from "node:assert/strict";
import { TaskKind, TaskStatus } from "@/app/generated/prisma/enums";
import { disconnectDatabase, getPrisma } from "@/lib/prisma";
import { runTaskNow, startTask, sweepStaleTasks, TaskBusyError } from "@/services/tasks";

const SUBJECT = "fictional-task-subject";
const created: string[] = [];

async function main() {
  const database = getPrisma();
  try {
    const done = await runTaskNow({ kind: TaskKind.INTAKE_PIPELINE, label: "Fictional success", subjectId: SUBJECT }, async (task) => {
      await task.progress("halfway");
    });
    created.push(done);
    const doneRow = await database.task.findUniqueOrThrow({ where: { id: done } });
    assert.equal(doneRow.status, TaskStatus.DONE);
    assert.equal(doneRow.progress, null, "A finished task must not keep stale progress text.");
    assert.ok(doneRow.finishedAt);

    const failed = await runTaskNow({ kind: TaskKind.INTAKE_PIPELINE, label: "Fictional failure", subjectId: SUBJECT }, async () => {
      throw new Error("Fictional downstream failure.");
    });
    created.push(failed);
    const failedRow = await database.task.findUniqueOrThrow({ where: { id: failed } });
    assert.equal(failedRow.status, TaskStatus.FAILED, "A throwing task must be recorded, not lost.");
    assert.equal(failedRow.error, "Fictional downstream failure.");

    // A second run on the same subject must be refused while the first is still going.
    const deferred: Array<() => Promise<void>> = [];
    const running = await startTask({ kind: TaskKind.INTAKE_PIPELINE, label: "Fictional running", subjectId: SUBJECT }, async () => {}, (run) => { deferred.push(run); });
    created.push(running);
    await assert.rejects(
      () => startTask({ kind: TaskKind.INTAKE_PIPELINE, label: "Fictional duplicate", subjectId: SUBJECT }, async () => {}, (run) => { deferred.push(run); }),
      (error: unknown) => error instanceof TaskBusyError && error.existingId === running,
      "Two tasks must never run against the same subject.",
    );
    assert.equal(deferred.length, 1, "The refused task must not have been handed to the runtime.");

    // The server can stop mid-task, so an abandoned RUNNING row must not spin forever.
    await database.task.update({ where: { id: running }, data: { startedAt: new Date(Date.now() - 60 * 60 * 1000) } });
    await sweepStaleTasks();
    const swept = await database.task.findUniqueOrThrow({ where: { id: running } });
    assert.equal(swept.status, TaskStatus.FAILED);
    assert.match(swept.error ?? "", /server stopped/i);

    await deferred[0]!();

    // The outreach page shows a wait instead of 404 while a first draft is still being written, and
    // it recognises that state only by this exact subject, kind and status.
    const waiting = await database.task.create({
      data: { kind: TaskKind.OUTREACH_REGENERATE, label: "Fictional draft in progress", subjectId: SUBJECT },
    });
    created.push(waiting.id);
    const pageQuery = () => database.task.count({
      where: { subjectId: SUBJECT, kind: TaskKind.OUTREACH_REGENERATE, status: TaskStatus.RUNNING },
    });
    assert.equal(await pageQuery(), 1, "A draft still being written must be discoverable, or the page falls back to 404.");
    await database.task.update({ where: { id: waiting.id }, data: { status: TaskStatus.DONE, finishedAt: new Date() } });
    assert.equal(await pageQuery(), 0, "Once nothing is running, a missing draft really is a missing page.");

    console.log("Background task check passed: success, failure, duplicate refusal, stale sweep, and the in-progress draft state all recorded.");
  } finally {
    await database.task.deleteMany({ where: { subjectId: SUBJECT } });
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Background task check failed.");
    process.exitCode = 1;
  })
  .finally(disconnectDatabase);
