import assert from "node:assert/strict";
import { ActivityType } from "@/app/generated/prisma/enums";
import { disconnectDatabase, getPrisma } from "@/lib/prisma";

class RollbackCheck extends Error {}

async function main() {
  try {
    await getPrisma().$transaction(async (database) => {
      const job = await database.opportunity.create({
        data: {
          title: "Sample Contract Role",
          vendor: { create: { name: "Example Vendor" } },
          recruiter: {
            create: { name: "Sample Recruiter", email: "recruiter@example.invalid" },
          },
          applicationTrack: { create: { nextAction: "Review sample record" } },
          activities: {
            create: { type: ActivityType.JOB_CREATED, description: "Sample verification event." },
          },
        },
        include: { applicationTrack: true, activities: true, recruiter: true, vendor: true },
      });

      assert.equal(job.applicationTrack?.currentStage, "DISCOVERED");
      assert.equal(job.activities.length, 1);
      assert.equal(job.recruiter?.email, "recruiter@example.invalid");
      assert.equal(job.vendor?.name, "Example Vendor");
      throw new RollbackCheck();
    });
  } catch (error) {
    if (!(error instanceof RollbackCheck)) throw error;
  }

  console.log("Phase 1 relational read/write check passed; sample transaction rolled back.");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Phase 1 database check failed.");
    process.exitCode = 1;
  })
  .finally(disconnectDatabase);
