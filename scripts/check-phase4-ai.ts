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

  // A stated engagement must survive extraction: leaving it UNKNOWN silently disables the C2C rules
  // that depend on it downstream.
  const corpToCorp = await analyzeJobText({
    sourceType: JobSourceType.PLAIN_TEXT,
    originalSender: null,
    rawText: "Sample Front-end Engineer, 12 month contract, Corp to Corp only. Remote. Required: React and TypeScript.",
  });
  const bothOffered = await analyzeJobText({
    sourceType: JobSourceType.PLAIN_TEXT,
    originalSender: null,
    rawText: "Sample Data Engineer. Open to W2 or C2C. Onsite in Example City. Required: Python and SQL.",
  });

  assert.equal(corpToCorp.employmentType, "C2C", "A Corp to Corp intake must not come back UNKNOWN.");
  assert.equal(bothOffered.employmentType, "W2", "The first stated arrangement wins.");
  assert.ok(
    bothOffered.warnings.some((warning) => /c2c|corp/i.test(warning.message) || /c2c|corp/i.test(warning.evidence ?? "")),
    "The arrangement that could not be stored must survive as a warning.",
  );
  assert.equal(direct.employmentType, "W2");

  assert.ok(linkedin.title && linkedin.requiredSkills.length > 0);
  assert.ok(direct.title && direct.requiredSkills.length > 0);
  assert.equal(forwarded.recruiterEmail, "contact@example.invalid");
  assert.notEqual(forwarded.recruiterEmail, "forwarder@example.invalid");
  console.log("Phase 4 AI checks passed for fictional LinkedIn, direct email, forwarded JD, and engagement-type samples.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Phase 4 AI check failed.");
  process.exitCode = 1;
});
