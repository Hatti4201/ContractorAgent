import "dotenv/config";
import assert from "node:assert/strict";
import type { Prisma } from "@/app/generated/prisma/client";
import {
  ActivityType,
  ApplicationStage,
  OutreachDraftStatus,
  OutreachMode,
  RoleFamily,
} from "@/app/generated/prisma/enums";
import { disconnectDatabase, getPrisma } from "@/lib/prisma";

class RollbackCheck extends Error {}

async function main() {
  try {
    await getPrisma().$transaction(async (database) => {
      const resume = await database.resume.create({
        data: { name: "Fictional Outreach Resume", roleFamily: RoleFamily.PYTHON_AI, filePath: "/private/example.invalid/fictional.pdf", version: "sample-v1", active: false },
      });
      const jobCase = { title: "Fictional Python AI Engineer", roleFamily: RoleFamily.PYTHON_AI, recruiterEmail: "recruiter@example.invalid", confidence: 0.95 };
      const opportunity = await database.opportunity.create({
        data: {
          title: "Fictional Python AI Engineer",
          roleFamily: RoleFamily.PYTHON_AI,
          selectedResumeId: resume.id,
          jobCase: jobCase as Prisma.InputJsonValue,
          applicationTrack: { create: { currentStage: ApplicationStage.DISCOVERED } },
        },
      });
      const draft = await database.outreachDraft.create({
        data: {
          opportunityId: opportunity.id,
          mode: OutreachMode.FIRST_OUTREACH,
          toAddress: "recruiter@example.invalid",
          subject: "Fictional role inquiry",
          body: "Fictional email body.",
          attachmentResumeId: resume.id,
          contextFingerprint: "fictional-context-fingerprint",
          validation: { status: "PASS", issues: [] },
          status: OutreachDraftStatus.DRAFT,
        },
        include: { opportunity: true, attachmentResume: true },
      });
      await database.activity.create({ data: { opportunityId: opportunity.id, type: ActivityType.OUTREACH_DRAFT_GENERATED, description: "Fictional database check." } });
      assert.equal(draft.opportunity.id, opportunity.id);
      assert.equal(draft.attachmentResume.id, resume.id);
      assert.equal(draft.revision, 1);
      throw new RollbackCheck();
    });
  } catch (error) {
    if (!(error instanceof RollbackCheck)) throw error;
  }
  console.log("Phase 6 outreach draft relation and status check passed; sample transaction rolled back.");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Phase 6 database check failed.");
    process.exitCode = 1;
  })
  .finally(disconnectDatabase);
