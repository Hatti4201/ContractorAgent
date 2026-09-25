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
