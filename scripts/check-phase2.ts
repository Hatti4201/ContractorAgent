import assert from "node:assert/strict";
import { ActivityType, ApplicationStage, RoleFamily } from "@/app/generated/prisma/enums";
import { disconnectDatabase, getPrisma } from "@/lib/prisma";
import { summarizeDashboard } from "@/services/dashboard-analytics";

class RollbackCheck extends Error {}

async function main() {
  try {
    await getPrisma().$transaction(async (database) => {
      const created = await database.opportunity.create({
        data: {
          title: "Sample Analytics Role",
          roleFamily: RoleFamily.JAVA_BACKEND,
          vendor: { create: { name: "Example Analytics Vendor" } },
          recruiter: { create: { name: "Sample Analytics Recruiter" } },
          applicationTrack: { create: { currentStage: ApplicationStage.SUBMITTED_TO_CLIENT } },
          activities: {
            create: [
              { type: ActivityType.OUTREACH_SENT, description: "Sample outreach event." },
              { type: ActivityType.RECRUITER_REPLY, description: "Sample reply event." },
              { type: ActivityType.CLIENT_SUBMISSION, description: "Sample submission event." },
            ],
          },
        },
      });
      const rows = await database.opportunity.findMany({
        where: { roleFamily: RoleFamily.JAVA_BACKEND, vendorId: created.vendorId! },
        select: {
          id: true,
          title: true,
          client: true,
          createdAt: true,
          vendor: { select: { id: true, name: true } },
          recruiter: { select: { id: true, name: true } },
          applicationTrack: { select: { currentStage: true } },
          activities: { select: { type: true, occurredAt: true } },
        },
      });
      const summary = summarizeDashboard(rows, "all");

      assert.equal(summary.counts.total, 1);
      assert.equal(summary.counts.outreach, 1);
      assert.equal(summary.counts.replies, 1);
      assert.equal(summary.counts.submitted, 1);
      assert.equal(summary.conversions[0]?.rate, 1);
      assert.equal(summary.pipeline[3]?.jobs[0]?.id, created.id);
      throw new RollbackCheck();
    });
  } catch (error) {
    if (!(error instanceof RollbackCheck)) throw error;
  }

  console.log("Phase 2 dashboard database check passed; sample transaction rolled back.");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Phase 2 database check failed.");
    process.exitCode = 1;
  })
  .finally(disconnectDatabase);
