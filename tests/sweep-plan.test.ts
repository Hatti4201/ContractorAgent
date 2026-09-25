import assert from "node:assert/strict";
import test from "node:test";
import type { FeedPost } from "../lib/linkedin-feed";
import type { PolicyFacts } from "../services/application-policy";
import { parseTriage } from "../services/post-triage";
import { postFingerprint, sweepItemState, sweepVerdict } from "../services/sweep-plan";

const post = (author: string, body: string): FeedPost => ({ author, profileUrl: `https://www.linkedin.com/in/${author.replace(/\s/g, "")}`, headline: null, age: "1h", body });
const facts: PolicyFacts = { engagements: ["C2C"], locations: [{ city: "Alpharetta", state: "GA" }], remote: false, localOnly: false, relocationAccepted: false, inPersonInterview: false };

test("two recruiters posting one JD are two posts; one recruiter reposting it is the same one", () => {
  const body = (address: string) => `Java Front End Lead, Alpharetta GA, C2C. Resumes to ${address}`;
  const first = postFingerprint(post("Example One", body("one@vendor.test")));
  assert.notEqual(first, postFingerprint(post("Example Two", body("two@vendor.test"))));
  assert.equal(first, postFingerprint(post("Example One", `${body("one@vendor.test")}  `)));
});

test("a screened post goes on only as a relevant job within the rules, with an email in it", () => {
  const job = { kind: "JOB" as const, relevant: true, reason: null, title: "Java Lead", recruiterEmail: "one@vendor.test", facts };
  assert.equal(sweepVerdict(job).outcome, "QUEUED");
  assert.equal(sweepVerdict({ ...job, recruiterEmail: null }).outcome, "NO_EMAIL");
  assert.equal(sweepVerdict({ ...job, relevant: false }).outcome, "NOT_RELEVANT");
  assert.equal(sweepVerdict({ ...job, kind: "CANDIDATE_OFFER" }).outcome, "NOISE");
  assert.equal(sweepVerdict({ ...job, facts: { ...facts, engagements: ["W2"] } }).outcome, "SKIPPED");
});

test("the screen's email is kept only when the post really contains it", () => {
  const entry = { kind: "JOB", relevant: true, reason: null, title: "Java", engagements: [], locations: [], remote: true, localOnly: false, relocationAccepted: false, inPersonInterview: false };
  const texts = ["Send to 𝗮𝗹𝗲𝘅@𝘃𝗲𝗻𝗱𝗼𝗿.𝘁𝗲𝘀𝘁 or hr@vendor.test", "No address here"];
  const [first, second] = parseTriage({ posts: [
    { ...entry, index: 1, recruiterEmail: "invented@vendor.test" },
    { ...entry, index: 0, recruiterEmail: "HR@vendor.test" },
  ] }, texts);
  assert.equal(first!.recruiterEmail, "hr@vendor.test");
  assert.equal(second!.recruiterEmail, null, "An address the model made up is dropped.");
  assert.throws(() => parseTriage({ posts: [{ ...entry, index: 0, recruiterEmail: null }] }, texts), /skipped a post/);
});

test("a queued post's state follows its intake, job and draft", () => {
  const draft = { autoSendState: null, autoSentAt: null, outlookState: "CREATED", autoSendError: null, outlookError: null };
  const intake = { status: "CONFIRMED" as const, hasPreview: true, stopReason: null, draft };
  assert.equal(sweepItemState({ ...intake, status: "PENDING", hasPreview: false, draft: null }, false).state, "WORKING");
  assert.equal(sweepItemState({ ...intake, status: "PENDING", hasPreview: false, draft: null }, true).state, "NEEDS_YOU");
  assert.equal(sweepItemState({ ...intake, status: "PENDING", draft: null }, false).state, "READY", "A written email waiting for review is not a problem.");
  assert.equal(sweepItemState({ ...intake, status: "PENDING", stopReason: "Match 30% is below 50%." }, false).detail, "Match 30% is below 50%.");
  assert.equal(sweepItemState(intake, false).state, "IN_OUTLOOK");
  assert.equal(sweepItemState({ ...intake, draft: { ...draft, autoSendState: "SCHEDULED" } }, false).state, "SCHEDULED");
  assert.equal(sweepItemState({ ...intake, draft: { ...draft, autoSendState: "SENT", autoSentAt: new Date() } }, false).state, "SENT");
  assert.equal(sweepItemState({ ...intake, draft: { ...draft, autoSendState: "CANCELLED", autoSendError: "Daily limit" } }, false).detail, "Daily limit");
  assert.equal(sweepItemState({ ...intake, status: "SKIPPED" }, false).state, "SKIPPED");
});

test("reasons shrink to a tag a glance can read", async () => {
  const { shortReason } = await import("../services/sweep-plan");
  assert.deepEqual(shortReason("Skipped by your application rules: W2 only, in Dallas, TX: outside the Bay Area you take C2C only."), { kind: "rules", label: "W2 · Dallas, TX" });
  assert.equal(shortReason("Local candidates only, in Irving, TX, with no relocation.")?.label, "Local only");
  assert.equal(shortReason("Face-to-face interview required in Blue Ash, OH, outside the Bay Area.")?.label, "F2F");
  assert.equal(shortReason("Match 42% is below 50%; missing Kafka, AWS.")?.label, "42%");
  assert.equal(shortReason("Hotlist or bench sales: consultants on offer, not a job.")?.label, "Hotlist");
  assert.equal(shortReason("No email in the post: message the author on LinkedIn if it is worth it.")?.label, "No email");
  assert.equal(shortReason("Eligibility conflict: Work authorization: USC/GC only.")?.label, "Eligibility");
  assert.equal(shortReason('The same JD is already tracked as "Java Lead".')?.label, "Duplicate");
  assert.equal(shortReason(null), null);
});
