import "dotenv/config";

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EmploymentType, JobSourceType, OutreachMode, RoleFamily, WorkArrangement } from "@/app/generated/prisma/enums";
import type { JobCase } from "@/services/job-case";
import { generateOutreachContent, validateOutreachContent, type OutreachInput } from "@/services/outreach-agent";

const skills: Record<RoleFamily, string[]> = {
  JAVA_BACKEND: ["Java", "Spring Boot"],
  JAVA_FULLSTACK: ["Java", "Angular"],
  JAVA_REACT: ["Java", "React"],
  JAVA_AI: ["Java", "Python", "Generative AI"],
  REACT: ["React", "TypeScript"],
  REACT_FULLSTACK: ["React", "Node.js"],
};

const titles: Record<RoleFamily, string> = {
  JAVA_BACKEND: "Senior Java Backend Engineer",
  JAVA_FULLSTACK: "Java Full Stack Engineer",
  JAVA_REACT: "Java React Developer",
  JAVA_AI: "Java AI Engineer",
  REACT: "React Frontend Engineer",
  REACT_FULLSTACK: "React Full Stack Engineer",
};

function sample(roleFamily: RoleFamily): JobCase {
  return {
    title: titles[roleFamily], client: "Example Client", vendor: null,
    recruiterName: "Example Recruiter", recruiterEmail: "recruiter@example.invalid", recruiterPhone: null,
    location: null, workArrangement: WorkArrangement.REMOTE, employmentType: EmploymentType.CONTRACT,
    rate: null, yearsRequired: null, requiredSkills: skills[roleFamily], visaRequirement: null,
    localRequirement: null, relocationRequirement: null, clearanceRequirement: null, roleFamily,
    confidence: 0.95, warnings: [], evidence: [],
  };
}

async function main() {
  assert.ok(process.env.OPENAI_API_KEY, "OPENAI_API_KEY is not configured.");
  const directory = await mkdtemp(join(tmpdir(), "contractor-agent-phase6-ai-"));
  let needsReview = 0;
  try {
    const filePath = join(directory, "fictional-resume.pdf");
    await writeFile(filePath, "%PDF-1.7\nfictional Phase 6 fixture");
    for (const roleFamily of Object.values(RoleFamily)) {
      const input: OutreachInput = {
        mode: OutreachMode.FIRST_OUTREACH,
        toAddress: "recruiter@example.invalid",
        recruiterName: "Example Recruiter",
        jobCase: sample(roleFamily),
        resume: { id: roleFamily, name: `Fictional ${roleFamily} Resume`, version: "sample-v1", roleFamily, filePath, active: true },
        source: { sourceType: JobSourceType.PLAIN_TEXT, originalSender: null, rawText: "Fictional role source." },
        activityTypes: [], activitySummary: [],
        approvedContext: "This is a fictional test profile. Approved candidate facts: Example Candidate has professional experience with Java, Spring Boot, Angular, React, TypeScript, Node.js, Python, and Generative AI, and may say the selected resume is attached. Do not state years, rate, visa category, employer, clearance, certification, location, relocation, or local-candidate status.",
      };
      const content = await generateOutreachContent(input);
      const validation = await validateOutreachContent(input, content);
      assert.ok(content.subject && content.body);
      assert.ok(validation.status === "PASS" || validation.status === "NEEDS_REVIEW");
      if (validation.status === "NEEDS_REVIEW") needsReview += 1;
    }
    console.log(`Phase 6 AI generated and validated all six fictional Role Families; ${needsReview} correctly remained NEEDS_REVIEW. No email content was logged.`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Phase 6 AI check failed.");
  process.exitCode = 1;
});
