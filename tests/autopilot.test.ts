import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { EmploymentType, JobSourceType, OutreachMode, WorkArrangement } from "../app/generated/prisma/enums";
import {
  autoSendDailyLimit,
  autoSendDelayMinutes,
  autoSendPlan,
  autopilotAccepts,
  autopilotApplies,
  autopilotDuplicateHold,
  autopilotMode,
  sendQuota,
} from "../services/autopilot";
import type { DuplicateMatch, JobCase } from "../services/job-case";
import { generateOutreachContent, type OutreachInput } from "../services/outreach-agent";
import { buildResumeRoute } from "../services/resume-router";

const jobCase: JobCase = {
  title: "Fictional Java Engineer",
  client: null,
  vendor: null,
  recruiterName: "Example Recruiter",
  recruiterEmail: "recruiter@example.invalid",
  recruiterPhone: null,
  location: null,
  workArrangement: WorkArrangement.REMOTE,
  employmentType: EmploymentType.CONTRACT,
  rate: null,
  yearsRequired: null,
  requiredSkills: [],
  visaRequirement: null,
  localRequirement: null,
  relocationRequirement: null,
  clearanceRequirement: null,
  roleFamily: "JAVA_BACKEND",
  confidence: 0.9,
  warnings: [],
  evidence: [],
};

function match(overrides: Partial<DuplicateMatch>): DuplicateMatch {
  return {
    id: "job", title: "Fictional Java Engineer", client: null, stage: null, createdAt: new Date(0), score: 0.5,
    reasons: ["Similar job title"], vendor: null, recruiter: null, rate: null, exact: false, ...overrides,
  };
}

test("the autopilot stays off unless set to draft, and only rides mailbox intakes", () => {
  assert.equal(autopilotMode(undefined), "off");
  assert.equal(autopilotMode("on"), "off", "Anything unrecognised must mean off.");
  assert.equal(autopilotMode(" DRAFT "), "draft");
  assert.ok(autopilotApplies({ sourceMessageId: "AAMk-fictional" }, "draft"));
  assert.ok(!autopilotApplies({ sourceMessageId: null }, "draft"), "Pasted text has someone at the keyboard already.");
  assert.ok(!autopilotApplies({ sourceMessageId: "AAMk-fictional" }, "off"));
});

test("a loose fit goes through, a blocking fact does not", () => {
  assert.ok(autopilotAccepts({ status: "PASS", issues: [] }));
  assert.ok(autopilotAccepts({ status: "NEEDS_REVIEW", issues: [{ field: "body", severity: "NEEDS_REVIEW", message: "Tone is generic." }] }));
  assert.ok(!autopilotAccepts({ status: "NEEDS_REVIEW", issues: [{ field: "body", severity: "BLOCK", message: "Unsupported visa claim." }] }));
  assert.ok(!autopilotAccepts(null));
});

test("a duplicate holds only when it would reach the same recruiter twice", () => {
  assert.equal(autopilotDuplicateHold(jobCase, []), null);
  assert.match(autopilotDuplicateHold(jobCase, [match({ exact: true, score: 1 })]) ?? "", /same JD/);
  assert.match(autopilotDuplicateHold(jobCase, [match({ recruiter: "example recruiter" })]) ?? "", /already has a similar job/);
  assert.equal(autopilotDuplicateHold(jobCase, [match({ recruiter: "Another Vendor Recruiter" })]), null, "Another vendor on one role is a normal channel.");
  assert.equal(autopilotDuplicateHold(jobCase, [match({ recruiter: "Example Recruiter", reasons: ["Same client"] })]), null);
});

test("several resumes in one family stop the review path but not the autopilot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "contractor-agent-autopilot-"));
  try {
    const path = join(directory, "resume.pdf");
    await writeFile(path, "%PDF-1.7\nfictional");
    const resumes = [
      { id: "b", name: "Java B", roleFamily: "JAVA_BACKEND", filePath: path, version: "v1", active: true },
      { id: "a", name: "Java A", roleFamily: "JAVA_BACKEND", filePath: path, version: "v1", active: true },
    ];
    const reviewed = await buildResumeRoute("JAVA_BACKEND", 0.9, resumes);
    assert.equal(reviewed.recommended, null);
    assert.match(reviewed.issue ?? "", /More than one/);
    const automatic = await buildResumeRoute("JAVA_BACKEND", 0.9, resumes, { allowSeveral: true });
    assert.equal(automatic.recommended?.id, "a", "The first by name is taken.");
    assert.equal(automatic.issue, null);
    assert.equal((await buildResumeRoute("JAVA_BACKEND", 0.5, resumes, { allowSeveral: true })).recommended, null, "Confidence still gates.");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a rewrite hands the rejected email and its issues back to the writer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "contractor-agent-autopilot-"));
  try {
    const path = join(directory, "resume.pdf");
    await writeFile(path, "%PDF-1.7\nfictional");
    const inputs: Record<string, unknown>[] = [];
    const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      inputs.push(JSON.parse(String((JSON.parse(String(init?.body)) as { input: string }).input)) as Record<string, unknown>);
      return new Response(JSON.stringify({ output_text: JSON.stringify({ subject: "Fictional", body: "Resume attached." }) }), { status: 200 });
    }) as typeof fetch;
    const input: OutreachInput = {
      mode: OutreachMode.FIRST_OUTREACH,
      toAddress: "recruiter@example.invalid",
      recruiterName: "Example Recruiter",
      jobCase,
      resume: { id: "a", name: "Java A", version: "v1", roleFamily: "JAVA_BACKEND", filePath: path, active: true },
      source: { sourceType: JobSourceType.PLAIN_TEXT, originalSender: null, rawText: "Fictional." },
      activityTypes: [],
      activitySummary: [],
      approvedContext: "Fictional candidate.",
    };
    const previous = { subject: "Old", body: "Old body" };
    const issues = [{ field: "body", severity: "NEEDS_REVIEW" as const, message: "Fictional issue." }];
    await generateOutreachContent(input, { apiKey: "test-key", fetcher });
    await generateOutreachContent(input, { apiKey: "test-key", fetcher }, { previous, issues });
    assert.ok(!("previousAttempt" in inputs[0]!), "A first draft carries no previous attempt.");
    assert.deepEqual(inputs[1]!.previousAttempt, { email: previous, issues });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("shadow and send ride the same autopilot as draft", () => {
  assert.equal(autopilotMode("shadow"), "shadow");
  assert.equal(autopilotMode(" Send "), "send");
  assert.equal(autopilotMode("sendnow"), "off");
  for (const mode of ["draft", "shadow", "send"] as const) assert.ok(autopilotApplies({ sourceMessageId: "AAMk-fictional" }, mode));
});

test("only shadow and send plan anything, and both wait out the delay", () => {
  const now = new Date("2026-09-24T17:00:00Z");
  assert.equal(autoSendPlan("draft", now, 10), null);
  assert.equal(autoSendPlan("off", now, 10), null);
  assert.deepEqual(autoSendPlan("shadow", now, 10), { state: "SHADOW", at: new Date("2026-09-24T17:10:00Z") });
  assert.deepEqual(autoSendPlan("send", now, 30), { state: "SCHEDULED", at: new Date("2026-09-24T17:30:00Z") });
});

test("the delay and limit fall back to safe defaults on anything unreadable", () => {
  assert.equal(autoSendDelayMinutes(undefined), 10);
  assert.equal(autoSendDelayMinutes("0"), 10, "No window at all is not a delay.");
  assert.equal(autoSendDelayMinutes("15"), 15);
  assert.equal(autoSendDelayMinutes("2.5"), 10);
  assert.equal(autoSendDailyLimit(undefined), 20);
  assert.equal(autoSendDailyLimit("0"), 0, "Zero is a real choice: send nothing.");
  assert.equal(autoSendDailyLimit("9999"), 20);
  assert.equal(sendQuota(20, 5), 15);
  assert.equal(sendQuota(20, 25), 0);
});
