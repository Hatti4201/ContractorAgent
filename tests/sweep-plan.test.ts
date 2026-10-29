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
  const w2 = sweepVerdict({ ...job, facts: { ...facts, engagements: ["W2"] } });
  assert.equal(w2.outcome, "QUEUED");
  assert.equal(w2.decision?.pitch, "W2");
});

test("the screen's email is kept only when the post really contains it", () => {
  const entry = { kind: "JOB", relevant: true, reason: null, title: "Java", engagements: [], locations: [], remote: true, localOnly: false, relocationAccepted: false, inPersonInterview: false };
  const texts = ["Send to 𝗮𝗹𝗲𝘅@𝘃𝗲𝗻𝗱𝗼𝗿.𝘁𝗲𝘀𝘁 or hr@vendor.test", "Send to hr@vendor.test; share me @adam@fusiongs.com"];
  const [first, second] = parseTriage({ posts: [
    { ...entry, index: 1, recruiterEmail: "@adam@fusiongs.com" },
    { ...entry, index: 0, recruiterEmail: "HR@vendor.test" },
  ] }, texts);
  assert.equal(first!.recruiterEmail, "hr@vendor.test");
  assert.equal(second!.recruiterEmail, "adam@fusiongs.com", "A leading social @ is not part of the email.");
  assert.throws(() => parseTriage({ posts: [{ ...entry, index: 0, recruiterEmail: null }] }, texts), /skipped a post/);
});

test("a screened JobCase is validated and ready for intake reuse", () => {
  const entry = {
    kind: "JOB", relevant: true, reason: null, title: "Java Engineer", recruiterEmail: "one@vendor.test",
    engagements: ["C2C"], locations: [], remote: true, localOnly: false, relocationAccepted: false, inPersonInterview: false,
    jobCase: {
      title: "Java Engineer", client: null, vendor: null, recruiterName: "Recruiter", recruiterEmail: "one@vendor.test", recruiterPhone: null,
      location: "Remote", workArrangement: "REMOTE", employmentType: "C2C", rate: null, yearsRequired: "5+ years", requiredSkills: ["Java"],
      visaRequirement: null, localRequirement: null, relocationRequirement: null, clearanceRequirement: null, roleFamily: "JAVA_BACKEND",
      confidence: 0.9, warnings: [], evidence: [],
    },
  };
  const [triaged] = parseTriage({ posts: [{ ...entry, index: 0 }] }, ["Java Engineer, remote, C2C. Send to one@vendor.test"]);
  assert.equal(triaged!.jobCase?.recruiterEmail, "one@vendor.test");
  assert.equal(triaged!.jobCase?.roleFamily, "JAVA_BACKEND");
  assert.ok(triaged!.jobCase?.warnings.some((warning) => warning.field === "rate"));
});

test("an explicit Local Only marker is enforced even when the model misses it", () => {
  const entry = { kind: "JOB", relevant: true, reason: null, title: "Java Developer", recruiterEmail: "hr@vendor.test", engagements: [], locations: [{ city: "Chicago", state: "IL" }], remote: false, localOnly: false, relocationAccepted: false, inPersonInterview: false };
  const [triaged] = parseTriage({ posts: [{ ...entry, index: 0 }] }, ["Title: Java Developer\nLocation: Chicago, IL – Local Only"]);
  assert.equal(triaged!.facts.localOnly, true);
  assert.equal(sweepVerdict(triaged!).outcome, "SKIPPED");
});

test("a queued post's state follows its intake, job and draft", () => {
  const draft = { autoSendState: null, autoSentAt: null, outlookState: "CREATED", autoSendError: null, outlookError: null };
  const intake = { status: "CONFIRMED" as const, hasPreview: true, stopReason: null, draft };
  assert.deepEqual(sweepItemState(null, false), { state: "WORKING", detail: null }, "A new Sweep is still creating its Intake, not discarded.");
  assert.equal(sweepItemState({ ...intake, status: "PENDING", hasPreview: false, draft: null }, false).state, "WORKING");
  assert.equal(sweepItemState({ ...intake, status: "PENDING", hasPreview: false, draft: null }, true).state, "NEEDS_YOU");
  assert.equal(sweepItemState({ ...intake, status: "PENDING", draft: null }, false).state, "READY", "A written email waiting for review is not a problem.");
  assert.equal(sweepItemState({ ...intake, status: "PENDING", stopReason: "Match 30% is below 50%." }, false).detail, "Match 30% is below 50%.");
  assert.equal(sweepItemState(intake, false).state, "IN_OUTLOOK");
  assert.equal(sweepItemState({ ...intake, draft: { ...draft, outlookState: "SENT" } }, false).state, "SENT", "A manually sent Outlook draft is sent in the sweep too.");
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
  assert.equal(shortReason("YOE below requirement: 13+ years of experience")?.label, "YOE");
  assert.equal(shortReason("Eligibility conflict: Work authorization: USC/GC only.")?.label, "Only USC/GC");
  assert.equal(shortReason("Eligibility conflict: Work authorization: H1B (your context: STEM OPT).")?.label, "Only H1B");
  assert.equal(shortReason("Eligibility conflict: Work authorization: All visas except H1B & OPT.")?.label, "No H1B/OPT");
  assert.equal(shortReason("The email asks the recruiter about C2C, but the source says C2H and #W2Jobs; the employment/payment arrangement is conflicting.")?.label, "C2H/C2C需确认");
  assert.equal(shortReason("The email states the resume version; say only that the resume is attached.")?.label, "简历版本需删除");
  assert.equal(shortReason('The same JD is already tracked as "Java Lead".')?.label, "Duplicate");
  assert.equal(shortReason(null), null);
});
