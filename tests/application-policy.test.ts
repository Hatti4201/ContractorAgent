import assert from "node:assert/strict";
import test from "node:test";
import type { JobCase } from "../services/job-case";
import { applicationDecision, inBayArea, pitchedCase, readStoredPolicy, type PolicyFacts } from "../services/application-policy";

const facts = (overrides: Partial<PolicyFacts>): PolicyFacts => ({
  engagements: [], locations: [], remote: false, localOnly: false, relocationAccepted: false, inPersonInterview: false, ...overrides,
});
const at = (city: string, state: string | null = null) => ({ city, state });

test("the Bay Area is known by its cities, and a name shared with another state needs CA", () => {
  assert.ok(inBayArea(at("Sunnyvale")));
  assert.ok(inBayArea(at("San Jose", "CA")));
  assert.ok(inBayArea(at("Bay Area")));
  assert.ok(inBayArea(at("Dublin", "CA")));
  assert.ok(!inBayArea(at("Dublin")), "Dublin alone may be Ohio.");
  assert.ok(!inBayArea(at("Newark", "NJ")));
  assert.ok(!inBayArea(at("San Jose", "CR")));
  assert.ok(!inBayArea(at("Irving", "TX")));
});

test("W2 is taken only in the Bay Area or fully remote", () => {
  assert.equal(applicationDecision(facts({ engagements: ["W2"], locations: [at("Pleasanton", "CA")] })).verdict, "APPLY");
  assert.equal(applicationDecision(facts({ engagements: ["W2"], remote: true })).verdict, "APPLY");
  const dallas = applicationDecision(facts({ engagements: ["W2"], locations: [at("Dallas", "TX")] }));
  assert.equal(dallas.verdict, "SKIP");
  assert.match(dallas.reason, /W2 only, in Dallas, TX/);
  assert.equal(applicationDecision(facts({ engagements: ["FULL_TIME"], locations: [at("Austin", "TX")] })).verdict, "SKIP");
  assert.equal(applicationDecision(facts({ engagements: ["W2"], remote: true, localOnly: true, locations: [at("Austin", "TX")] })).verdict, "SKIP", "Remote for Texas residents only is not remote for you.");
});

test("C2C is taken anywhere unless the job is local-only or wants a face-to-face interview", () => {
  const atlanta = applicationDecision(facts({ engagements: ["C2C", "W2"], locations: [at("Alpharetta", "GA")] }));
  assert.equal(atlanta.verdict, "APPLY");
  assert.equal(atlanta.pitch, "C2C", "Outside the Bay Area the email offers C2C.");
  assert.equal(applicationDecision(facts({ locations: [at("Charlotte", "NC")] })).pitch, "C2C", "A job naming no arrangement is asked as C2C.");
  assert.equal(applicationDecision(facts({ engagements: ["C2C"], localOnly: true, locations: [at("Irving", "TX")] })).verdict, "SKIP");
  assert.equal(applicationDecision(facts({ engagements: ["C2C"], localOnly: true, relocationAccepted: true, locations: [at("Irving", "TX")] })).verdict, "APPLY");
  const ohio = applicationDecision(facts({ engagements: ["C2C"], inPersonInterview: true, relocationAccepted: true, locations: [at("Blue Ash", "OH")] }));
  assert.equal(ohio.verdict, "SKIP");
  assert.match(ohio.reason, /Face-to-face/);
});

test("in the Bay Area a face-to-face interview and local-only are fine", () => {
  const decision = applicationDecision(facts({ engagements: ["C2C", "W2"], localOnly: true, inPersonInterview: true, locations: [at("Mountain View", "CA"), at("New York", "NY")] }));
  assert.equal(decision.verdict, "APPLY");
  assert.equal(decision.pitch, null, "Both arrangements are fine here, so the email keeps what the post said.");
  assert.equal(applicationDecision(facts({ engagements: ["W2"], locations: [at("Fremont", "CA")] })).pitch, "W2");
});

test("stored facts are read back and decided again, never trusted as a stored verdict", () => {
  const stored = { facts: facts({ engagements: ["W2"], locations: [at("Dallas", "TX")] }), decision: { verdict: "APPLY", reason: "tampered", pitch: null } };
  assert.equal(readStoredPolicy(stored)?.decision.verdict, "SKIP");
  assert.equal(readStoredPolicy({ facts: { engagements: ["SOMETHING"] } }), null);
  assert.equal(readStoredPolicy(null), null);
});

test("the rules' arrangement is written into the job, with a note saying why", () => {
  const analysis: JobCase = {
    title: "Java Lead", client: null, vendor: null, recruiterName: null, recruiterEmail: "r@vendor.test", recruiterPhone: null,
    location: "Alpharetta, GA", workArrangement: "ONSITE", employmentType: "W2", rate: null, yearsRequired: null, requiredSkills: [],
    visaRequirement: null, localRequirement: null, relocationRequirement: null, clearanceRequirement: null, roleFamily: null,
    confidence: 0.9, warnings: [], evidence: [],
  };
  const decision = applicationDecision(facts({ engagements: ["W2", "C2C"], locations: [at("Alpharetta", "GA")] }));
  const pitched = pitchedCase(analysis, decision);
  assert.equal(pitched.employmentType, "C2C");
  assert.match(pitched.warnings.at(-1)!.message, /Set to C2C by your application rules/);
  const unchanged: JobCase = { ...analysis, employmentType: "C2C" };
  assert.equal(pitchedCase(unchanged, decision), unchanged);
});
