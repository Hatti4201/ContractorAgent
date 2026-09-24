import assert from "node:assert/strict";
import test from "node:test";
import { appUrl, buildDigest, digestDue, digestEmpty, digestSettings, isDigestMessage, type DigestData } from "../services/digest";
import { scanWindowFromEnv } from "../services/mail-schedule";

const window = scanWindowFromEnv({ APP_TIME_ZONE: "America/Los_Angeles", MAIL_SCAN_DAYS: "1,2,3,4,5" });
const on = digestSettings({ DAILY_DIGEST: "on", DIGEST_HOUR: "15" });

const empty: DigestData = {
  since: new Date("2026-09-23T22:00:00Z"), sent: [], notSent: [], waitingInOutlook: [], needsInput: [], followUps: 0, scanFailures: 0, scanError: null,
};

test("the digest stays off unless asked for, and reads its hour and recipient safely", () => {
  assert.equal(digestSettings({}).enabled, false);
  assert.equal(digestSettings({ DAILY_DIGEST: "true" }).enabled, false, "Only on means on.");
  assert.equal(digestSettings({ MAIL_SCAN_END_HOUR: "17" }).hour, 17, "It defaults to when the scan window closes.");
  assert.equal(digestSettings({ DIGEST_HOUR: "25" }).hour, 15);
  assert.equal(digestSettings({ DIGEST_TO: "me@example.invalid" }).to, "me@example.invalid");
  assert.equal(digestSettings({ DIGEST_TO: "not an address" }).to, null);
});

test("one digest per local scan day, once the hour has come", () => {
  // Thursday 2026-09-24, 15:30 in Los Angeles.
  const afternoon = new Date("2026-09-24T22:30:00Z");
  assert.ok(digestDue(afternoon, "2026-09-23", on, window));
  assert.ok(!digestDue(afternoon, "2026-09-24", on, window), "Already sent today.");
  assert.ok(!digestDue(new Date("2026-09-24T21:30:00Z"), null, on, window), "14:30 is before the hour.");
  assert.ok(!digestDue(new Date("2026-09-26T22:30:00Z"), null, on, window), "Saturday is not a scan day.");
  assert.ok(!digestDue(afternoon, null, { ...on, enabled: false }, window));
  // 18:00 local is still the 24th, even though UTC has already moved to the 25th.
  assert.ok(!digestDue(new Date("2026-09-25T01:00:00Z"), "2026-09-24", on, window));
});

test("the app's own digest is recognised so the scan never judges it", () => {
  assert.ok(isDigestMessage({ subject: "[Contractor Agent] 3 sent automatically, 1 needs you" }));
  assert.ok(!isDigestMessage({ subject: "RE: [Contractor Agent] question" }), "A reply is someone's real mail.");
  assert.ok(!isDigestMessage({ subject: "Java Contract Role" }));
});

test("links point at the app, from APP_URL or the Outlook callback", () => {
  assert.equal(appUrl({ APP_URL: "https://agent.example.invalid/some/path" }), "https://agent.example.invalid");
  assert.equal(appUrl({ MICROSOFT_REDIRECT_URI: "http://localhost:3008/api/outlook/callback" }), "http://localhost:3008");
  assert.equal(appUrl({ APP_URL: "not a url", MICROSOFT_REDIRECT_URI: "http://localhost:3000/api/outlook/callback" }), "http://localhost:3000");
});

test("a quiet day sends nothing, a failing scan always reports", () => {
  assert.ok(digestEmpty(empty));
  assert.ok(!digestEmpty({ ...empty, scanFailures: 2 }));
  assert.ok(!digestEmpty({ ...empty, followUps: 1 }));
});

test("the digest counts, links and escapes everything that came from mail", () => {
  const { subject, html } = buildDigest({
    ...empty,
    sent: [{ opportunityId: "job1", title: "Java <script>alert(1)</script> Engineer", recruiter: "Example & Co", at: new Date("2026-09-24T18:00:00Z") }],
    notSent: [{ opportunityId: "job2", title: "React Dev", recruiter: null, reason: "Outlook refused to send: Mail.Send is not granted." }],
    needsInput: [{ intakeId: "in1", title: "Python AI", reason: "Match 40% is below 50%; missing Kafka." }],
    scanFailures: 3,
    scanError: "Graph <b>401</b>",
  }, "https://agent.example.invalid", (value) => value.toISOString());
  assert.equal(subject, "[Contractor Agent] 1 sent automatically, 2 need you");
  assert.ok(isDigestMessage({ subject }), "The digest carries its own marker.");
  assert.ok(!html.includes("<script>"), "A JD title can never become markup.");
  assert.ok(html.includes("Java &lt;script&gt;alert(1)&lt;/script&gt; Engineer"));
  assert.ok(html.includes("Example &amp; Co"));
  assert.ok(html.includes("Graph &lt;b&gt;401&lt;/b&gt;"));
  assert.ok(html.includes('href="https://agent.example.invalid/jobs/job1/outreach"'));
  assert.ok(html.includes('href="https://agent.example.invalid/intakes/in1/review"'));
  assert.match(html, /failed 3 time\(s\) in a row/);
  assert.match(html, /Match 40% is below 50%/);
  assert.equal(buildDigest({ ...empty, needsInput: [{ intakeId: "x", title: "t", reason: null }] }, "https://a.invalid", String).subject,
    "[Contractor Agent] 0 sent automatically, 1 needs you");
});
