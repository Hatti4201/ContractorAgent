import "dotenv/config";
import assert from "node:assert/strict";
import { ExposureChannel, ExposureResult } from "@/app/generated/prisma/enums";
import { disconnectDatabase, getPrisma } from "@/lib/prisma";
import { exposureConfig, settledByHistory } from "@/services/exposure-rules";
import { countedToday, exposureState, priorResults } from "@/services/exposure-run";

class RollbackCheck extends Error {}

async function main() {
  try {
    await getPrisma().$transaction(async (database) => {
      const opportunitiesBefore = await database.opportunity.count();
      const countedBefore = await countedToday(database);
      const record = (externalId: string, result: ExposureResult) => database.exposureApplication.create({ data: {
        channel: ExposureChannel.DICE,
        externalId,
        title: "Fictional Phase 9 Java Role",
        company: "Example Staffing (fictional)",
        url: `https://www.dice.com/job-detail/${externalId}`,
        result,
        answers: [{ question: "Willing to work onsite?", kind: "willingness", answer: "Yes", factQuote: null }],
      } });

      await record("fictional-phase9-rehearsed", ExposureResult.DRY_RUN_READY);
      await record("fictional-phase9-applied", ExposureResult.APPLIED);
      await record("fictional-phase9-failed", ExposureResult.FAILED);

      // A rehearsal settles the job for further dry runs but not for the real run.
      const rehearsed = await priorResults(database, "fictional-phase9-rehearsed");
      assert.equal(settledByHistory(rehearsed, "dryrun"), true);
      assert.equal(settledByHistory(rehearsed, "on"), false);
      assert.equal(settledByHistory(await priorResults(database, "fictional-phase9-applied"), "on"), true);
      assert.equal(settledByHistory(await priorResults(database, "fictional-phase9-failed"), "on"), false);

      // Applied and rehearsed count toward the daily limit; failures do not.
      assert.equal(await countedToday(database), countedBefore + 2);

      // Settings saved from the page survive the round trip and win over .env; Stop is a plain flag.
      await exposureState(database);
      await database.exposureState.update({ where: { id: "primary" }, data: { settings: { mode: "dryrun", keywords: ["java", "fictional keyword"], perRunLimit: 12 }, stopRequested: true } });
      const saved = await database.exposureState.findUniqueOrThrow({ where: { id: "primary" } });
      const config = exposureConfig(saved.settings, {});
      assert.deepEqual(config.keywords, ["java", "fictional keyword"]);
      assert.equal(config.perRunLimit, 12);
      assert.equal(saved.stopRequested, true);

      // FR-14: the channel keeps its own records and never creates an Opportunity.
      assert.equal(await database.opportunity.count(), opportunitiesBefore);
      throw new RollbackCheck();
    });
  } catch (error) {
    if (!(error instanceof RollbackCheck)) throw error;
  }
  console.log("Phase 9 exposure record, dedupe, daily-count, settings and stop-flag check passed; fictional transaction rolled back.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Phase 9 database check failed.");
  process.exitCode = 1;
}).finally(disconnectDatabase);
