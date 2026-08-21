import assert from "node:assert/strict";
import { ActivityType, ApplicationStage } from "@/app/generated/prisma/enums";
import { disconnectDatabase, getPrisma } from "@/lib/prisma";
import { buildAttentionItems } from "@/services/attention";

class RollbackCheck extends Error {}

const select = {
  id: true,
  title: true,
  client: true,
  recruiter: { select: { name: true } },
  vendor: { select: { name: true } },
  applicationTrack: {
    select: {
      currentStage: true,
      waitingOn: true,
      nextAction: true,
      nextFollowUpAt: true,
      attentionClearedAt: true,
    },
  },
  activities: { select: { type: true, occurredAt: true } },
} as const;

async function main() {
  const now = new Date("2026-08-21T12:00:00.000Z");
  try {
    await getPrisma().$transaction(async (database) => {
      const created = await database.opportunity.create({
        data: {
          title: "Sample Follow-up Role",
          client: "Example Client",
          applicationTrack: { create: { currentStage: ApplicationStage.OUTREACH_SENT } },
          activities: {
            create: {
              type: ActivityType.OUTREACH_SENT,
              description: "Sample outreach event.",
              occurredAt: new Date("2026-08-18T12:00:00.000Z"),
            },
          },
        },
      });
      let row = await database.opportunity.findUniqueOrThrow({ where: { id: created.id }, select });
      assert.equal(buildAttentionItems([row], now, "UTC").length, 1);

      await database.applicationTrack.update({
        where: { opportunityId: created.id },
        data: { attentionClearedAt: now },
      });
      row = await database.opportunity.findUniqueOrThrow({ where: { id: created.id }, select });
      assert.equal(buildAttentionItems([row], now, "UTC").length, 0);
      throw new RollbackCheck();
    });
  } catch (error) {
    if (!(error instanceof RollbackCheck)) throw error;
  }

  console.log("Phase 3 follow-up database check passed; sample transaction rolled back.");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Phase 3 database check failed.");
    process.exitCode = 1;
  })
  .finally(disconnectDatabase);
