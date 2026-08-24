import "dotenv/config";
import assert from "node:assert/strict";
import { IntakeStatus } from "@/app/generated/prisma/enums";
import { disconnectDatabase, getPrisma } from "@/lib/prisma";
import { countQueuedIntakes, queuedIntakes } from "@/services/intake-queue";
import { jobFingerprint } from "@/services/job-case";

class RollbackCheck extends Error {}

async function main() {
  const before = await countQueuedIntakes();
  console.log(`Pending intakes currently waiting for review: ${before}`);

  try {
    await getPrisma().$transaction(async (database) => {
      const raw = "Fictional queue check source. Sample Java Engineer.";
      const pending = await database.jobIntake.create({
        data: { sourceType: "PLAIN_TEXT", rawText: raw, receivedAt: new Date(), fingerprint: jobFingerprint(raw) },
      });
      const confirmed = await database.jobIntake.create({
        data: { sourceType: "PLAIN_TEXT", rawText: `${raw} confirmed`, receivedAt: new Date(), fingerprint: jobFingerprint(`${raw} confirmed`), status: IntakeStatus.CONFIRMED },
      });

      const queue = await queuedIntakes(database);
      const listed = queue.find((intake) => intake.id === pending.id);
      assert.ok(listed, "A pending intake must be reachable from the queue, not only from a task notice.");
      assert.equal(listed.state, "ANALYZING", "An intake with no analysis yet is still being prepared.");
      assert.ok(!queue.some((intake) => intake.id === confirmed.id), "A confirmed intake already owns an opportunity and must not be listed.");

      // Discarding is limited to pending intakes; a confirmed one must survive the same call.
      assert.equal((await database.jobIntake.deleteMany({ where: { id: confirmed.id, status: IntakeStatus.PENDING } })).count, 0);
      assert.equal((await database.jobIntake.deleteMany({ where: { id: pending.id, status: IntakeStatus.PENDING } })).count, 1);
      throw new RollbackCheck();
    });
  } catch (error) {
    if (!(error instanceof RollbackCheck)) throw error;
  }

  assert.equal(await countQueuedIntakes(), before, "The check must leave the real queue untouched.");
  console.log("Intake queue check passed: pending sources are listed, confirmed ones are not, and only pending ones can be discarded.");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Intake queue check failed.");
    process.exitCode = 1;
  })
  .finally(disconnectDatabase);
