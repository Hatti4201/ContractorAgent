import assert from "node:assert/strict";
import test from "node:test";
import {
  ApplicationStage,
  EmploymentType,
  JobSourceType,
  RoleFamily,
  WorkArrangement,
} from "../app/generated/prisma/enums";
import { analyzeJobText } from "../services/job-analyzer";
import {
  addRequiredReviewWarnings,
  findDuplicateMatches,
  jobCaseFactChanges,
  jobFingerprint,
  parseJobCase,
  readJobCaseFacts,
  type JobCase,
} from "../services/job-case";

function sample(overrides: Partial<JobCase> = {}): JobCase {
  return {
    title: "Sample Software Engineer",
    client: null,
    vendor: null,
    recruiterName: null,
    recruiterEmail: null,
    recruiterPhone: null,
    location: null,
    workArrangement: WorkArrangement.UNKNOWN,
    employmentType: EmploymentType.UNKNOWN,
    rate: null,
    yearsRequired: null,
    requiredSkills: [],
    visaRequirement: null,
    localRequirement: null,
    relocationRequirement: null,
    clearanceRequirement: null,
    roleFamily: null,
    confidence: 0.8,
    warnings: [],
    evidence: [],
    ...overrides,
  };
}

test("representative intake outputs stay strict and preserve unknown facts", () => {
  const samples = [
    sample({ title: "Sample React Engineer", roleFamily: RoleFamily.REACT, requiredSkills: ["React", "TypeScript"] }),
    sample({
      title: "Sample Java Engineer",
      recruiterName: "Example Recruiter",
      recruiterEmail: "recruiter@example.invalid",
      employmentType: EmploymentType.W2,
      roleFamily: RoleFamily.JAVA_BACKEND,
    }),
    sample({
      title: "Sample Full Stack Engineer",
      recruiterName: "Forwarded Contact",
      recruiterEmail: "contact@example.invalid",
      workArrangement: WorkArrangement.REMOTE,
      roleFamily: RoleFamily.REACT_FULLSTACK,
    }),
  ];

  for (const fixture of samples) assert.deepEqual(parseJobCase(fixture), fixture);
  assert.equal(samples[0]?.client, null);
  assert.equal(addRequiredReviewWarnings(samples[0]!).warnings.filter((warning) => warning.severity === "NEEDS_REVIEW").length, 6);
  assert.throws(() => parseJobCase({ ...samples[0], invented: "not allowed" }));
});

test("duplicate detection uses fingerprint and confirmed CRM facts", () => {
  const receivedAt = new Date("2026-08-21T12:00:00.000Z");
  const jobCase = sample({
    title: "Sample Java Backend Engineer",
    client: "Example Client",
    location: "Example City",
    vendor: "Example Vendor",
    rate: "Example rate",
    employmentType: EmploymentType.CONTRACT,
  });
  const rawText = "Sample Java role contact one@example.invalid";
  const fingerprint = jobFingerprint(rawText);
  const candidates = [
    {
      id: "exact",
      title: "Earlier title",
      client: null,
      location: null,
      employmentType: EmploymentType.UNKNOWN,
      rawJd: "Sample Java role contact two@example.invalid",
      jobCase: null,
      jdFingerprint: null,
      createdAt: receivedAt,
      vendor: null,
      applicationTrack: { currentStage: ApplicationStage.OUTREACH_SENT },
    },
    {
      id: "near",
      title: "Java Backend Engineer",
      client: "Example Client",
      location: "Example City",
      employmentType: EmploymentType.CONTRACT,
      rawJd: null,
      jobCase,
      jdFingerprint: null,
      createdAt: new Date("2026-08-01T12:00:00.000Z"),
      vendor: { name: "Example Vendor" },
      applicationTrack: { currentStage: ApplicationStage.RECRUITER_ENGAGED },
    },
    {
      id: "unrelated",
      title: "Sample Designer",
      client: null,
      location: null,
      employmentType: EmploymentType.UNKNOWN,
      rawJd: null,
      jobCase: null,
      jdFingerprint: null,
      createdAt: new Date("2024-01-01T12:00:00.000Z"),
      vendor: null,
      applicationTrack: { currentStage: ApplicationStage.REJECTED },
    },
  ];

  const matches = findDuplicateMatches(jobCase, fingerprint, receivedAt, candidates);
  assert.deepEqual(matches.map((match) => match.id), ["exact", "near"]);
  assert.equal(matches[0]?.score, 1);
  assert.ok((matches[1]?.score ?? 0) >= 0.8);
});

test("analyzer requests strict non-stored output and validates the response", async () => {
  const requests: Record<string, unknown>[] = [];
  const fixture = sample({ title: "Sample API Role", roleFamily: RoleFamily.JAVA_REACT });
  const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(fixture) }] }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  const result = await analyzeJobText({
    sourceType: JobSourceType.PLAIN_TEXT,
    originalSender: null,
    rawText: "Fictional sample role.",
  }, { apiKey: "test-key", model: "test-model", fetcher });

  const requestBody = requests[0]!;
  assert.equal(result.title, fixture.title);
  assert.equal(requestBody.store, false);
  assert.equal(requestBody.model, "test-model");
  assert.equal((requestBody.text as { format?: { strict?: boolean } }).format?.strict, true);
});

test("correcting a JobCase edits only facts and reports exactly what changed", () => {
  const original: JobCase = {
    title: "Java Engineer", client: null, vendor: null, recruiterName: "Pat", recruiterEmail: "pat@example.invalid",
    recruiterPhone: null, location: "Remote", workArrangement: WorkArrangement.REMOTE, employmentType: EmploymentType.W2,
    rate: "$65/hour", yearsRequired: "5+ years", requiredSkills: ["Java", "React"], visaRequirement: null,
    localRequirement: null, relocationRequirement: null, clearanceRequirement: null, roleFamily: RoleFamily.JAVA_BACKEND,
    confidence: 0.98,
    warnings: [{ field: "rate", severity: "NEEDS_REVIEW", message: "Rate needs review.", evidence: null }],
    evidence: [{ field: "rate", quote: "$65/hour" }],
  };

  const form = new FormData();
  form.set("rate", "$70/hour");
  form.set("yearsRequired", "5+ years");
  form.set("visaRequirement", "H1B transfer accepted");
  form.set("requiredSkills", "Java\nReact");
  const corrected = readJobCaseFacts(form, original);

  assert.equal(corrected.rate, "$70/hour");
  assert.equal(corrected.visaRequirement, "H1B transfer accepted");
  assert.equal(corrected.clearanceRequirement, null, "A field left blank is cleared, not silently kept.");
  assert.deepEqual(corrected.requiredSkills, ["Java", "React"]);

  // The model's own report must survive a human correction untouched.
  assert.equal(corrected.confidence, 0.98);
  assert.deepEqual(corrected.warnings, original.warnings);
  assert.deepEqual(corrected.evidence, original.evidence);
  assert.equal(corrected.title, "Java Engineer", "Identity fields are not owned by this form.");
  assert.equal(corrected.recruiterEmail, "pat@example.invalid");

  assert.deepEqual(jobCaseFactChanges(original, corrected), ["Rate", "Visa"]);
  assert.deepEqual(jobCaseFactChanges(original, original), [], "An unchanged record reports no correction.");
  assert.deepEqual(
    jobCaseFactChanges(original, { ...original, requiredSkills: ["Java"] }),
    ["Required skills"],
  );
});
