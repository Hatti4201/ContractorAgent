import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { EmploymentType, JobSourceType, OutreachMode, WorkArrangement } from "../app/generated/prisma/enums";
import {
  autoSendDailyLimit,
  autoSendPlan,
  autopilotAccepts,
  autopilotApplies,
  autopilotDuplicateHold,
  autopilotMode,
  modeFromSetting,
  parseAutopilotSettings,
  readyForAutopilot,
  resolveAutopilotSettings,
  settingOfMode,
  staggeredAutoSendAt,
  AUTO_SEND_MAX_DELAY_MS,
  AUTO_SEND_MIN_DELAY_MS,
  autopilotRoute,
  rankForSending,
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

test("the autopilot stays off unless set to a mode, and then rides every intake", () => {
  assert.equal(autopilotMode(undefined), "off");
  assert.equal(autopilotMode("on"), "off", "Anything unrecognised must mean off.");
  assert.equal(autopilotMode(" DRAFT "), "draft");
  assert.ok(autopilotApplies("draft"));
  assert.ok(!autopilotApplies("off"));
});

test("the autopilot answers the way the job reached you", () => {
  const recruiter = "recruiter@example.invalid";
  const scanned = { sourceType: JobSourceType.DIRECT_EMAIL, sourceMessageId: "AAMk-fictional", originalSender: recruiter };
  assert.deepEqual(autopilotRoute(scanned, recruiter), { mode: OutreachMode.DIRECT_EMAIL_REPLY, thread: "source" });
  assert.deepEqual(autopilotRoute({ ...scanned, sourceMessageId: null, originalSender: `Example Recruiter <${recruiter}>` }, recruiter),
    { mode: OutreachMode.DIRECT_EMAIL_REPLY, thread: "lookup" }, "A pasted email from the recruiter looks for their thread.");
  assert.deepEqual(autopilotRoute({ ...scanned, originalSender: "friend@example.invalid" }, recruiter),
    { mode: OutreachMode.FORWARDED_JD_OUTREACH, thread: null }, "A friend's forward in the inbox writes to the recruiter, not back to the friend.");
  assert.deepEqual(autopilotRoute({ ...scanned, originalSender: "relay@dice.com" }, recruiter), { mode: OutreachMode.FORWARDED_JD_OUTREACH, thread: null });
  assert.deepEqual(autopilotRoute({ ...scanned, originalSender: `a${recruiter}` }, recruiter).mode, OutreachMode.FORWARDED_JD_OUTREACH,
    "A longer address that merely contains the recruiter's is someone else.");
  assert.deepEqual(autopilotRoute({ sourceType: JobSourceType.FORWARDED_JD, sourceMessageId: null, originalSender: "friend@example.invalid" }, recruiter),
    { mode: OutreachMode.FORWARDED_JD_OUTREACH, thread: null });
  assert.deepEqual(autopilotRoute({ sourceType: JobSourceType.LINKEDIN_POST, sourceMessageId: null, originalSender: null }, recruiter),
    { mode: OutreachMode.FIRST_OUTREACH, thread: null });
  assert.deepEqual(autopilotRoute({ sourceType: JobSourceType.PLAIN_TEXT, sourceMessageId: null, originalSender: null }, recruiter),
    { mode: OutreachMode.FIRST_OUTREACH, thread: null });
});

test("only a PASS validation goes through", () => {
  assert.ok(autopilotAccepts({ status: "PASS", issues: [] }));
  assert.ok(!autopilotAccepts({ status: "NEEDS_REVIEW", issues: [{ field: "body", severity: "NEEDS_REVIEW", message: "Tone is generic." }] }));
  assert.ok(!autopilotAccepts({ status: "NEEDS_REVIEW", issues: [{ field: "body", severity: "BLOCK", message: "Unsupported visa claim." }] }));
  assert.ok(!autopilotAccepts(null));
});

test("a duplicate holds only when it would reach the same recruiter twice", () => {
  assert.equal(autopilotDuplicateHold(jobCase, []), null);
  assert.match(autopilotDuplicateHold(jobCase, [match({ exact: true, score: 1 })]) ?? "", /same JD/, "An exact copy from an unknown recruiter may be the same person.");
  assert.match(autopilotDuplicateHold(jobCase, [match({ exact: true, score: 1, recruiter: "Example Recruiter" })]) ?? "", /same JD/);
  assert.equal(
    autopilotDuplicateHold(jobCase, [match({ exact: true, score: 1, recruiter: "Colleague At The Same Vendor" })]),
    null,
    "Another recruiter posting the same JD is another chance to be picked.",
  );
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
  for (const mode of ["draft", "shadow", "send"] as const) assert.ok(autopilotApplies(mode));
});

test("only shadow and send plan anything; both are immediate", () => {
  const now = new Date("2026-09-24T17:00:00Z");
  assert.equal(autoSendPlan("draft", now), null);
  assert.equal(autoSendPlan("off", now), null);
  assert.deepEqual(autoSendPlan("shadow", now), { state: "SHADOW", at: now });
  assert.deepEqual(autoSendPlan("send", now), { state: "SCHEDULED", at: now });
});

test("automatic sends are staggered after the existing queue", () => {
  const now = new Date("2026-09-24T17:00:00Z");
  const last = new Date("2026-09-24T17:01:00Z");
  assert.equal(staggeredAutoSendAt(now, last, 0).getTime(), last.getTime() + AUTO_SEND_MIN_DELAY_MS);
  assert.equal(staggeredAutoSendAt(now, null, 1).getTime(), now.getTime() + AUTO_SEND_MAX_DELAY_MS);
});

test("the daily limit falls back to a safe default on anything unreadable", () => {
  assert.equal(autoSendDailyLimit(undefined), 50);
  assert.equal(autoSendDailyLimit("0"), 0, "Zero is a real choice: send nothing.");
  assert.equal(autoSendDailyLimit("9999"), 50);
  assert.equal(sendQuota(20, 5), 15);
  assert.equal(sendQuota(20, 25), 0);
});

test("the page's saved numbers win, one by one, over the environment", () => {
  const env = { MATCH_THRESHOLD: "60", AUTO_SEND_DAILY_LIMIT: "40", AUTO_SEND_START_TIME: "07:30", AUTO_SEND_END_TIME: "18:00" };
  assert.deepEqual(resolveAutopilotSettings(null, env), { threshold: 0.6, dailyLimit: 40, startTime: "07:30", endTime: "18:00" });
  assert.deepEqual(resolveAutopilotSettings(null, {}), { threshold: 0.5, dailyLimit: 50, startTime: "06:00", endTime: "15:00" });
  assert.deepEqual(
    resolveAutopilotSettings({ matchThreshold: 0.3, dailySendLimit: null, sendStartTime: null, sendEndTime: null }, env),
    { threshold: 0.3, dailyLimit: 40, startTime: "07:30", endTime: "18:00" },
    "Saving the threshold alone leaves the others to the environment.",
  );
  assert.equal(resolveAutopilotSettings({ matchThreshold: 0, dailySendLimit: 0, sendStartTime: "00:00", sendEndTime: "01:00" }, env).threshold, 0, "Zero is a real threshold, not unset.");
});

test("the settings form takes whole numbers in range and names the first one that is not", () => {
  const valid = { threshold: "30", dailyLimit: "50", sendStartTime: "06:00", sendEndTime: "15:00" };
  assert.deepEqual(parseAutopilotSettings(valid), { threshold: 0.3, dailyLimit: 50, startTime: "06:00", endTime: "15:00" });
  assert.deepEqual(parseAutopilotSettings({ ...valid, threshold: "101" }), { error: "threshold" });
  assert.deepEqual(parseAutopilotSettings({ ...valid, dailyLimit: "2.5" }), { error: "limit" });
  assert.deepEqual(parseAutopilotSettings({ ...valid, threshold: "" }), { error: "threshold" });
  assert.deepEqual(parseAutopilotSettings({ ...valid, sendStartTime: "18:00", sendEndTime: "06:00" }), { error: "sendWindow" });
});

test("over the daily limit the best matches are sent and the rest handed back", () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 8, 25, 9, minute));
  const due = [
    { id: "a", matchScore: 0.55, autoSendAt: at(0) },
    { id: "b", matchScore: 0.9, autoSendAt: at(5) },
    { id: "c", matchScore: null, autoSendAt: at(1) },
    { id: "d", matchScore: 0.9, autoSendAt: at(2) },
  ];
  const { sending, overLimit } = rankForSending(due, 2);
  assert.deepEqual(sending.map((draft) => draft.id), ["d", "b"], "Equal matches go in the order they fell due.");
  assert.deepEqual(overLimit.map((draft) => draft.id), ["a", "c"]);
  assert.deepEqual(rankForSending(due, 0).sending, []);
});

test("the dashboard switch decides once used; until then the environment does", () => {
  assert.equal(modeFromSetting(null, "send"), "send", "An existing setup keeps behaving as before.");
  assert.equal(modeFromSetting(undefined, undefined), "off");
  assert.equal(modeFromSetting("OFF", "send"), "off", "Switching off beats AUTOPILOT=send.");
  assert.equal(modeFromSetting("DRAFT", "off"), "shadow", "Drafts only still records when each would have gone out.");
  assert.equal(modeFromSetting("SEND", "off"), "send");
  assert.equal(settingOfMode("draft"), "DRAFT");
  assert.equal(settingOfMode("shadow"), "DRAFT");
  assert.equal(settingOfMode("off"), "OFF");
  assert.equal(settingOfMode("send"), "SEND");
});

test("only a job with a finished email and no pipeline stop can be taken on later", () => {
  const preview = { body: "Hello", toAddress: "r@vendor.test", brake: null };
  assert.ok(readyForAutopilot(preview));
  assert.ok(!readyForAutopilot({ ...preview, brake: "No usable resume matched this role family." }));
  assert.ok(!readyForAutopilot({ ...preview, body: null }));
  assert.ok(!readyForAutopilot(null));
});
