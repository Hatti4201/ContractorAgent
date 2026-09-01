import "dotenv/config";
import assert from "node:assert/strict";
import type { Prisma } from "@/app/generated/prisma/client";
import {
  ApplicationStage,
  EmploymentType,
  IntakeStatus,
  JobSourceType,
  RoleFamily,
  WorkArrangement,
} from "@/app/generated/prisma/enums";
import { disconnectDatabase, getPrisma } from "@/lib/prisma";
import { runIntakePipeline } from "@/services/intake-pipeline";
import { findDuplicateMatches, jobFingerprint, parseJobCase, type JobCase } from "@/services/job-case";

class RollbackCheck extends Error {}

const analysis: JobCase = {
  title: "Sample Java Backend Engineer",
  client: "Example Client",
  vendor: null,
  recruiterName: null,
  recruiterEmail: null,
  recruiterPhone: null,
  location: null,
  workArrangement: WorkArrangement.REMOTE,
  employmentType: EmploymentType.CONTRACT,
  rate: null,
  yearsRequired: null,
  requiredSkills: ["Java"],
  visaRequirement: null,
  localRequirement: null,
  relocationRequirement: null,
  clearanceRequirement: null,
  roleFamily: RoleFamily.JAVA_BACKEND,
  confidence: 0.9,
  warnings: [],
  evidence: [],
};

async function main() {
  try {
    await getPrisma().$transaction(async (database) => {
      const rawText = "Fictional Java backend contract role.";
      const fingerprint = jobFingerprint(rawText);
      await database.opportunity.create({
        data: {
          title: analysis.title!,
          client: analysis.client,
          employmentType: analysis.employmentType,
          rawJd: rawText,
          jobCase: analysis as unknown as Prisma.InputJsonValue,
          jdFingerprint: fingerprint,
          applicationTrack: { create: { currentStage: ApplicationStage.OUTREACH_SENT } },
        },
      });
      const intake = await database.jobIntake.create({
        data: {
          sourceType: JobSourceType.PLAIN_TEXT,
          rawText,
          receivedAt: new Date(),
          analysis: analysis as unknown as Prisma.InputJsonValue,
          fingerprint,
        },
        include: { opportunity: true },
      });
      assert.equal(intake.status, IntakeStatus.PENDING);
      assert.equal(intake.opportunity, null);
      assert.equal(parseJobCase(intake.analysis).title, analysis.title);

      const candidates = await database.opportunity.findMany({
        select: {
          id: true,
          title: true,
          client: true,
          location: true,
          employmentType: true,
          rawJd: true,
          jobCase: true,
          jdFingerprint: true,
          createdAt: true,
          vendor: { select: { name: true } },
          recruiter: { select: { name: true } },
          applicationTrack: { select: { currentStage: true } },
        },
      });
      assert.equal(findDuplicateMatches(analysis, fingerprint, intake.receivedAt, candidates)[0]?.score, 1);

      // Discarding a source deletes its row; a pipeline already running on it must end, not fail.
      await runIntakePipeline("intake-that-was-discarded");
      throw new RollbackCheck();
    });
  } catch (error) {
    if (!(error instanceof RollbackCheck)) throw error;
  }

  console.log("Phase 4 intake and duplicate database check passed; sample transaction rolled back.");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Phase 4 database check failed.");
    process.exitCode = 1;
  })
  .finally(disconnectDatabase);
