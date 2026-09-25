import assert from "node:assert/strict";
import test from "node:test";
import { EmploymentType, WorkArrangement } from "../app/generated/prisma/enums";
import { autopilotMatchHold, matchThreshold } from "../services/autopilot";
import type { JobCase } from "../services/job-case";
import { assessMatch, matchRequirements, parseMatch, readMatchReport, type MatchReport } from "../services/match-score";

const context = "Fictional candidate. 8+ years of Java and Spring Boot. Some React. Work authorization: H1B, no sponsorship change needed.";

const jobCase: JobCase = {
  title: "Fictional Java Engineer", client: null, vendor: null, recruiterName: null, recruiterEmail: null, recruiterPhone: null,
  location: null, workArrangement: WorkArrangement.REMOTE, employmentType: EmploymentType.CONTRACT, rate: null,
  yearsRequired: "8+ years", requiredSkills: ["Java", "React", "Kafka"], visaRequirement: "US Citizens only",
  localRequirement: null, relocationRequirement: null, clearanceRequirement: null, roleFamily: "JAVA_BACKEND",
  confidence: 0.9, warnings: [], evidence: [],
};

test("the requirements come from the JobCase, skills and eligibility apart", () => {
  assert.deepEqual(matchRequirements(jobCase), {
    skills: ["Java", "React", "Kafka", "8+ years of experience"],
    eligibility: ["Work authorization: US Citizens only"],
  });
});

test("the score is arithmetic over verdicts, and every verdict needs a real quote", () => {
  const report = parseMatch({
    skills: [
      { index: 0, verdict: "MET", evidence: "8+ years of Java" },
      { index: 1, verdict: "MET", evidence: "Expert React developer" },
      { index: 2, verdict: "MISSING", evidence: null },
      { index: 3, verdict: "MET", evidence: "8+   YEARS of java" },
    ],
    eligibility: [{ index: 0, verdict: "CONFLICT", evidence: "Work authorization: H1B" }],
  }, matchRequirements(jobCase), context);
  assert.deepEqual(report.requirements.map((item) => item.verdict), ["MET", "PARTIAL", "MISSING", "MET", "CONFLICT"],
    "An unquotable MET drops to PARTIAL; spacing and case do not make a quote unreal.");
  assert.equal(report.score, 0.63, "(1 + 0.5 + 0 + 1) / 4, eligibility not counted.");

  const invented = parseMatch({
    skills: [0, 1, 2, 3].map((index) => ({ index, verdict: "PARTIAL", evidence: "Kafka streaming expert" })),
    eligibility: [{ index: 0, verdict: "CONFLICT", evidence: "Not a US citizen" }],
  }, matchRequirements(jobCase), context);
  assert.equal(invented.score, 0, "An unquotable PARTIAL is MISSING.");
  assert.equal(invented.requirements[4]!.verdict, "UNKNOWN", "No job is held on a conflict the context does not state.");
});

test("a judgement set that skips, repeats or invents an index is refused", () => {
  const requirements = matchRequirements(jobCase);
  const eligibility = [{ index: 0, verdict: "UNKNOWN", evidence: null }];
  const skill = (index: number) => ({ index, verdict: "MISSING", evidence: null });
  assert.throws(() => parseMatch({ skills: [skill(0), skill(1), skill(2)], eligibility }, requirements, context), /every requirement/);
  assert.throws(() => parseMatch({ skills: [skill(0), skill(1), skill(2), skill(2)], eligibility }, requirements, context), /index/);
  assert.throws(() => parseMatch({ skills: [skill(0), skill(1), skill(2), skill(9)], eligibility }, requirements, context), /index/);
  assert.throws(() => parseMatch({ skills: [0, 1, 2, 3].map((index) => ({ index, verdict: "GREAT", evidence: null })), eligibility }, requirements, context), /verdict/);
});

test("a JD with nothing to judge makes no model call", async () => {
  const empty = { ...jobCase, requiredSkills: [], yearsRequired: null, visaRequirement: null };
  const report = await assessMatch(empty, context, { fetcher: async () => { throw new Error("No call expected."); } });
  assert.deepEqual(report, { score: null, requirements: [] });
});

test("the threshold reads fractions or percents and falls back to half", () => {
  assert.equal(matchThreshold(undefined), 0.5);
  assert.equal(matchThreshold("0.6"), 0.6);
  assert.equal(matchThreshold("60"), 0.6);
  assert.equal(matchThreshold("lots"), 0.5);
  assert.equal(matchThreshold("250"), 0.5);
});

test("the autopilot holds on a stated conflict or a low score, and nothing else", () => {
  const skill = (verdict: "MET" | "MISSING", requirement: string) => ({ kind: "skill" as const, requirement, verdict, evidence: null });
  const report = (score: number | null, extra: MatchReport["requirements"] = []): MatchReport => ({ score, requirements: [skill("MISSING", "Kafka"), ...extra] });
  assert.equal(autopilotMatchHold(report(0.5), 0.5), null, "Exactly the threshold passes.");
  assert.equal(autopilotMatchHold(report(null), 0.5), null, "Nothing to fall short of.");
  assert.match(autopilotMatchHold(report(0.4), 0.5) ?? "", /Match 40% is below 50%; missing Kafka/);
  assert.match(autopilotMatchHold(null, 0.5) ?? "", /could not be computed/);
  const conflict = { kind: "eligibility" as const, requirement: "Clearance: TS/SCI", verdict: "CONFLICT" as const, evidence: "No clearance" };
  assert.match(autopilotMatchHold(report(0.9, [conflict]), 0.5) ?? "", /Eligibility conflict: Clearance: TS\/SCI/);
  assert.equal(autopilotMatchHold(report(0.9, [{ ...conflict, verdict: "UNKNOWN" as const }]), 0.5), null);
});

test("a stored report reads back, and junk reads as none", () => {
  assert.deepEqual(readMatchReport({ score: 0.5, requirements: [] }), { score: 0.5, requirements: [] });
  assert.equal(readMatchReport(null), null);
  assert.equal(readMatchReport({ score: "high", requirements: [] }), null);
});
