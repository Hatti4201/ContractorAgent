import assert from "node:assert/strict";
import test from "node:test";
import { JobSourceType, OutreachMode } from "@/app/generated/prisma/enums";
import { detectIntakeSource } from "@/services/intake-source";
import { determineOutreachMode } from "@/services/outreach-agent";

const now = new Date("2026-08-22T18:00:00.000Z");

test("intake source detection names the envelope sender without asking the user", () => {
  const forwarded = detectIntakeSource(
    [
      "From: Robin Colleague <robin@example.invalid>",
      "Sent: Friday, August 21, 2026 9:14 AM",
      "To: Me",
      "Subject: FW: Java Backend Engineer",
      "",
      "---------- Forwarded message ---------",
      "From: Pat Recruiter <pat@vendor.example.invalid>",
      "Subject: Java Backend Engineer",
      "",
      "Contract role, 6 months.",
    ].join("\n"),
    now,
  );
  assert.equal(forwarded.sourceType, JobSourceType.FORWARDED_JD);
  // The forwarder must be reported, so outreach validation refuses to target them.
  assert.match(forwarded.originalSender ?? "", /robin@example\.invalid/);
  assert.doesNotMatch(forwarded.originalSender ?? "", /pat@vendor/);
  assert.equal(forwarded.receivedAt.toISOString().slice(0, 10), "2026-08-21");

  const direct = detectIntakeSource(
    [
      "From: Pat Recruiter <pat@vendor.example.invalid>",
      "To: me@example.invalid",
      "Subject: React Developer",
      "",
      "Are you available for a 12 month contract?",
    ].join("\n"),
    now,
  );
  assert.equal(direct.sourceType, JobSourceType.DIRECT_EMAIL);
  assert.match(direct.originalSender ?? "", /pat@vendor\.example\.invalid/);
  assert.equal(direct.receivedAt, now, "A message without a date header keeps the paste time.");

  const linkedin = detectIntakeSource("We are hiring a Java engineer. Apply via https://www.linkedin.com/jobs/view/123", now);
  assert.equal(linkedin.sourceType, JobSourceType.LINKEDIN_POST);
  assert.equal(linkedin.originalSender, null);

  const plain = detectIntakeSource("Senior Java Developer\nCharlotte, NC\nW2 only.", now);
  assert.equal(plain.sourceType, JobSourceType.PLAIN_TEXT);
  assert.equal(plain.originalSender, null);
  assert.equal(plain.receivedAt, now);
});

test("intake source detection refuses implausible header dates", () => {
  const future = detectIntakeSource("From: a@example.invalid\nDate: Tue, 3 Mar 2099 10:00:00 +0000\nTo: b", now);
  assert.equal(future.receivedAt, now, "A far future header date must not become the received time.");

  const nonsense = detectIntakeSource("From: a@example.invalid\nSent: sometime last week\nTo: b", now);
  assert.equal(nonsense.receivedAt, now, "An unparsable header date must not become the received time.");
});

test("detected source drives the outreach mode that guards the recipient", () => {
  const forwarded = detectIntakeSource("---------- Forwarded message ---------\nFrom: Robin <robin@example.invalid>\nJava role.", now);
  assert.equal(determineOutreachMode(forwarded.sourceType, []), OutreachMode.FORWARDED_JD_OUTREACH);

  const direct = detectIntakeSource("From: Pat <pat@vendor.example.invalid>\nTo: me\nReact role.", now);
  assert.equal(determineOutreachMode(direct.sourceType, []), OutreachMode.DIRECT_EMAIL_REPLY);

  const plain = detectIntakeSource("Senior Java Developer, W2 only.", now);
  assert.equal(determineOutreachMode(plain.sourceType, []), OutreachMode.FIRST_OUTREACH);
});
