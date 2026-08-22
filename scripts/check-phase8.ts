import assert from "node:assert/strict";
import type { Prisma } from "@/app/generated/prisma/client";
import {
  ActivityType,
  ApplicationStage,
  FollowUpEvent,
  FollowUpStatus,
} from "@/app/generated/prisma/enums";
import { disconnectDatabase, getPrisma } from "@/lib/prisma";

class RollbackCheck extends Error {}

async function main() {
  try {
    await getPrisma().$transaction(async (database) => {
      const opportunity = await database.opportunity.create({ data: {
        title: "Fictional Phase 8 Role",
        applicationTrack: { create: { currentStage: ApplicationStage.OUTREACH_SENT } },
      } });
      const suggestion = await database.followUpSuggestion.create({ data: {
        outlookMessageId: "fictional-phase8-message-id",
        opportunityId: opportunity.id,
        fromAddress: "recruiter@example.invalid",
        subject: "Fictional interview update",
        receivedAt: new Date("2026-08-22T12:00:00.000Z"),
        event: FollowUpEvent.INTERVIEW_SCHEDULED,
        proposedActivity: ActivityType.INTERVIEW_SCHEDULED,
        proposedStage: ApplicationStage.INTERVIEW_SCHEDULED,
        proposedWaitingOn: "Candidate",
        proposedNextAction: "Review fictional interview details.",
        confidence: 0.95,
        evidence: [{ quote: "fictional interview" }] as Prisma.InputJsonValue,
      } });
      const untouched = await database.applicationTrack.findUniqueOrThrow({ where: { opportunityId: opportunity.id } });
      assert.equal(untouched.currentStage, ApplicationStage.OUTREACH_SENT);

      await database.followUpSuggestion.update({ where: { id: suggestion.id }, data: { status: FollowUpStatus.CONFIRMED, decidedAt: new Date() } });
      await database.applicationTrack.update({ where: { opportunityId: opportunity.id }, data: { currentStage: suggestion.proposedStage! } });
      await database.activity.create({ data: { opportunityId: opportunity.id, type: suggestion.proposedActivity!, description: "Fictional confirmed suggestion." } });
      const confirmed = await database.opportunity.findUniqueOrThrow({ where: { id: opportunity.id }, include: { applicationTrack: true, activities: true, followUpSuggestions: true } });
      assert.equal(confirmed.applicationTrack?.currentStage, ApplicationStage.INTERVIEW_SCHEDULED);
      assert.equal(confirmed.activities.length, 1);
      assert.equal(confirmed.followUpSuggestions[0]?.status, FollowUpStatus.CONFIRMED);
      throw new RollbackCheck();
    });
  } catch (error) {
    if (!(error instanceof RollbackCheck)) throw error;
  }
  console.log("Phase 8 suggestion isolation and human-confirmed update check passed; fictional transaction rolled back.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Phase 8 database check failed.");
  process.exitCode = 1;
}).finally(disconnectDatabase);
