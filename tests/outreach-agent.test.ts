import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ActivityType,
  EmploymentType,
  JobSourceType,
  OutreachMode,
  RoleFamily,
  WorkArrangement,
} from "../app/generated/prisma/enums";
import type { JobCase } from "../services/job-case";
import {
  determineOutreachMode,
  generateOutreachContent,
  validateOutreachContent,
  type OutreachInput,
} from "../services/outreach-agent";

function jobCase(roleFamily: RoleFamily): JobCase {
  return {
    title: `Fictional ${roleFamily} Engineer`,
    client: "Example Client",
    vendor: null,
    recruiterName: "Example Recruiter",
    recruiterEmail: "recruiter@example.invalid",
    recruiterPhone: null,
    location: null,
    workArrangement: WorkArrangement.REMOTE,
    employmentType: EmploymentType.CONTRACT,
    rate: null,
    yearsRequired: null,
    requiredSkills: ["Sample Skill"],
    visaRequirement: null,
    localRequirement: null,
    relocationRequirement: null,
    clearanceRequirement: null,
    roleFamily,
    confidence: 0.95,
    warnings: [],
    evidence: [],
  };
}

test("every role family generates strict non-stored previews and validator blocks unsafe routing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "contractor-agent-outreach-"));
  try {
    const resumePath = join(directory, "fictional-resume.pdf");
    await writeFile(resumePath, "%PDF-1.7\nfictional outreach fixture");
    const requests: Record<string, unknown>[] = [];
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(request);
      const name = ((request.text as { format?: { name?: string } }).format?.name);
      const output = name === "outreach_draft"
        ? { subject: "Fictional role inquiry", body: "Hello Example Recruiter,\n\nI am interested in the fictional role. My approved resume is attached.\n\nRegards,\nExample Candidate" }
        : { status: "PASS", issues: [] };
      return new Response(JSON.stringify({ output_text: JSON.stringify(output) }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    for (const roleFamily of Object.values(RoleFamily)) {
      const input: OutreachInput = {
        mode: OutreachMode.FIRST_OUTREACH,
        toAddress: "recruiter@example.invalid",
        recruiterName: "Example Recruiter",
        jobCase: jobCase(roleFamily),
        resume: { id: roleFamily, name: `Fictional ${roleFamily} Resume`, version: "v1", roleFamily, filePath: resumePath, active: true },
        source: { sourceType: JobSourceType.PLAIN_TEXT, originalSender: null, rawText: "Fictional role text." },
        activityTypes: [],
        activitySummary: [],
        approvedContext: "Fictional candidate may state interest and attach the selected resume. Do not add personal claims.",
      };
      const content = await generateOutreachContent(input, { apiKey: "test-key", model: "test-model", fetcher });
      assert.equal((await validateOutreachContent(input, content, { apiKey: "test-key", model: "test-model", fetcher })).status, "PASS");
    }

    // Derived from the enum, so adding a role family never leaves this number behind.
    assert.equal(requests.length, Object.values(RoleFamily).length * 2, "Each family costs one generation and one validation.");
    for (const request of requests) {
      assert.equal(request.store, false);
      assert.equal(request.model, "test-model");
      assert.equal((request.text as { format?: { strict?: boolean } }).format?.strict, true);
      const inputPayload = JSON.parse(String(request.input)) as { attachmentConfirmed?: boolean; attachmentName?: string; attachmentVersion?: string };
      assert.equal(inputPayload.attachmentConfirmed, true);
      assert.match(inputPayload.attachmentName ?? "", /^Fictional .+ Resume$/);
      assert.equal(inputPayload.attachmentVersion, "v1");
    }

    assert.equal(determineOutreachMode(JobSourceType.DIRECT_EMAIL, []), OutreachMode.DIRECT_EMAIL_REPLY);
    assert.equal(determineOutreachMode(JobSourceType.FORWARDED_JD, []), OutreachMode.FORWARDED_JD_OUTREACH);
    assert.equal(determineOutreachMode(JobSourceType.LINKEDIN_DM, [ActivityType.RECRUITER_REPLY]), OutreachMode.THREAD_FOLLOW_UP);

    const manualModeInput: OutreachInput = {
      mode: OutreachMode.FIRST_OUTREACH,
      toAddress: "recruiter@example.invalid",
      recruiterName: "Example Recruiter",
      jobCase: jobCase(RoleFamily.JAVA_BACKEND),
      resume: { id: "manual-mode", name: "Fictional Java Resume", version: "v1", roleFamily: RoleFamily.JAVA_BACKEND, filePath: resumePath, active: true },
      source: { sourceType: JobSourceType.DIRECT_EMAIL, originalSender: "recruiter@example.invalid", rawText: "Fictional direct email." },
      activityTypes: [],
      activitySummary: [],
      approvedContext: "Fictional context.",
    };
    const manualModeValidation = await validateOutreachContent(manualModeInput, { subject: "Fictional", body: "Fictional body" }, { apiKey: "test-key", model: "test-model", fetcher });
    assert.equal(manualModeValidation.status, "PASS");

    const blocked: OutreachInput = {
      mode: OutreachMode.FORWARDED_JD_OUTREACH,
      toAddress: "recruiter@example.invalid",
      recruiterName: "Example Recruiter",
      jobCase: jobCase(RoleFamily.JAVA_BACKEND),
      resume: { id: "wrong", name: "Wrong Resume", version: "v1", roleFamily: RoleFamily.REACT, filePath: resumePath, active: true },
      source: { sourceType: JobSourceType.FORWARDED_JD, originalSender: "forwarder@example.invalid", rawText: "No recruiter address here." },
      activityTypes: [],
      activitySummary: [],
      approvedContext: "Fictional context.",
    };
    const report = await validateOutreachContent(blocked, { subject: "Fictional", body: "Fictional body" }, { fetcher: async () => { throw new Error("AI must not run when local checks fail."); } });
    assert.equal(report.status, "NEEDS_REVIEW");
    assert.ok(report.issues.some((issue) => issue.field === "attachment"));
    assert.ok(report.issues.some((issue) => issue.field === "toAddress"));

    blocked.resume.roleFamily = RoleFamily.JAVA_BACKEND;
    blocked.source.rawText = "Contact recruiter@example.invalid.evil instead.";
    const falsePositive = await validateOutreachContent(blocked, { subject: "Fictional", body: "Fictional body" }, { fetcher: async () => { throw new Error("AI must not run when recipient matching is unsafe."); } });
    assert.ok(falsePositive.issues.some((issue) => issue.field === "toAddress"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
