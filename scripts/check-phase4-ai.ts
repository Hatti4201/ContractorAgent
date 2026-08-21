import "dotenv/config";

import assert from "node:assert/strict";
import { JobSourceType } from "@/app/generated/prisma/enums";
import { analyzeJobText } from "@/services/job-analyzer";

async function main() {
  const linkedin = await analyzeJobText({
    sourceType: JobSourceType.LINKEDIN_POST,
    originalSender: null,
    rawText: "Sample React Engineer contract. Remote. Required skills: React and TypeScript.",
  });
  const direct = await analyzeJobText({
    sourceType: JobSourceType.DIRECT_EMAIL,
    originalSender: "recruiter@example.invalid",
    rawText: "I am Example Recruiter. Sample Java Backend Engineer for Example Client. W2. Required: Java and Spring Boot.",
  });
  const forwarded = await analyzeJobText({
    sourceType: JobSourceType.FORWARDED_JD,
    originalSender: "forwarder@example.invalid",
    rawText: "Forwarded JD: Sample Full Stack Engineer. Recruiter contact: contact@example.invalid. Required: React and Node.js.",
  });

  assert.ok(linkedin.title && linkedin.requiredSkills.length > 0);
  assert.ok(direct.title && direct.requiredSkills.length > 0);
  assert.equal(forwarded.recruiterEmail, "contact@example.invalid");
  assert.notEqual(forwarded.recruiterEmail, "forwarder@example.invalid");
  console.log("Phase 4 AI checks passed for fictional LinkedIn, direct email, and forwarded JD samples.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Phase 4 AI check failed.");
  process.exitCode = 1;
});
