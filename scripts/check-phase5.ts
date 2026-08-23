import "dotenv/config";
import assert from "node:assert/strict";
import { ActivityType, ApplicationStage, RoleFamily } from "@/app/generated/prisma/enums";
import { disconnectDatabase, getPrisma } from "@/lib/prisma";

class RollbackCheck extends Error {}

async function main() {
  try {
    await getPrisma().$transaction(async (database) => {
      const resume = await database.resume.create({
        data: {
          name: "Fictional Java Resume",
          roleFamily: RoleFamily.JAVA_BACKEND,
          filePath: "/private/example.invalid/fictional-java-resume.pdf",
          version: "sample-v1",
          active: true,
        },
      });
      const opportunity = await database.opportunity.create({
        data: {
          title: "Fictional Java Backend Engineer",
          roleFamily: RoleFamily.JAVA_BACKEND,
          selectedResumeId: resume.id,
          applicationTrack: { create: { currentStage: ApplicationStage.DISCOVERED } },
          activities: { create: { type: ActivityType.RESUME_SELECTED, description: "Fictional routing check." } },
        },
        include: { selectedResume: true, activities: true },
      });
      assert.equal(opportunity.selectedResume?.id, resume.id);
      assert.equal(opportunity.activities[0]?.type, ActivityType.RESUME_SELECTED);
      throw new RollbackCheck();
    });
  } catch (error) {
    if (!(error instanceof RollbackCheck)) throw error;
  }

  const indexes = await getPrisma().$queryRaw<Array<{ indexdef: string }>>`
    SELECT indexdef FROM pg_indexes WHERE indexname = 'resumes_one_active_per_role_family'
  `;
  assert.match(indexes[0]?.indexdef ?? "", /UNIQUE.*WHERE \(active = true\)/i);
  console.log("Phase 5 resume registry relation and one-active-per-role database check passed; sample transaction rolled back.");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Phase 5 database check failed.");
    process.exitCode = 1;
  })
  .finally(disconnectDatabase);
