import assert from "node:assert/strict";
import type { Prisma } from "@/app/generated/prisma/client";
import {
  ActivityType,
  OutlookDraftState,
  OutreachDraftStatus,
  OutreachMode,
  RoleFamily,
} from "@/app/generated/prisma/enums";
import { disconnectDatabase, getPrisma } from "@/lib/prisma";

class RollbackCheck extends Error {}

async function main() {
  try {
    await getPrisma().$transaction(async (database) => {
      const resume = await database.resume.create({ data: { name: "Fictional Phase 7 Resume", roleFamily: RoleFamily.JAVA_BACKEND, filePath: "/private/example.invalid/fictional.pdf", version: "sample-v1" } });
      const opportunity = await database.opportunity.create({ data: { title: "Fictional Phase 7 Role", roleFamily: RoleFamily.JAVA_BACKEND } });
      const draft = await database.outreachDraft.create({ data: {
        opportunityId: opportunity.id,
        mode: OutreachMode.FIRST_OUTREACH,
        toAddress: "recruiter@example.invalid",
        subject: "Fictional inquiry",
        body: "Fictional body.",
        attachmentResumeId: resume.id,
        contextFingerprint: "fictional-fingerprint",
        validation: { status: "PASS", issues: [] } as Prisma.InputJsonValue,
        status: OutreachDraftStatus.APPROVED,
        outlookState: OutlookDraftState.CREATED,
        outlookMessageId: "fictional-immutable-message-id",
        outlookDraftRevision: 1,
      } });
      const connection = await database.outlookConnection.create({ data: { encryptedTokenCache: "fictional-encrypted-cache" } });
      await database.activity.create({ data: { opportunityId: opportunity.id, type: ActivityType.OUTLOOK_DRAFT_CREATED, description: "Fictional database check." } });
      assert.equal(draft.outlookState, OutlookDraftState.CREATED);
      assert.equal(connection.id, "primary");
      throw new RollbackCheck();
    });
  } catch (error) {
    if (!(error instanceof RollbackCheck)) throw error;
  }
  console.log("Phase 7 Outlook draft state and encrypted connection relation check passed; sample transaction rolled back.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Phase 7 database check failed.");
  process.exitCode = 1;
}).finally(disconnectDatabase);
