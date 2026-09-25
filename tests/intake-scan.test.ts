import assert from "node:assert/strict";
import test from "node:test";
import {
  automatedSender,
  intakeBudgetSpent,
  MAX_CLASSIFIED_PER_SCAN,
  MAX_IMPORTED_PER_SCAN,
  intakeScanMode,
  parseScanDecision,
  shouldImport,
  worthClassifying,
} from "../services/intake-scan";

test("the scan stays off unless it was explicitly turned on", () => {
  assert.equal(intakeScanMode(undefined), "off");
  assert.equal(intakeScanMode(""), "off");
  assert.equal(intakeScanMode("true"), "off", "Anything unrecognised must mean off, never on.");
  assert.equal(intakeScanMode("ON"), "on");
  assert.equal(intakeScanMode(" dryrun "), "dryrun");
});

test("machines and mail with no job vocabulary never reach the model", () => {
  assert.ok(automatedSender("no-reply@example.invalid"));
  assert.ok(automatedSender("messages-noreply@linkedin.com"));
  assert.ok(automatedSender("someone@jobs.linkedin.com"), "A notification domain counts whatever the local part is.");
  assert.ok(!automatedSender("recruiter@example.invalid"));
  // Dice forwards a real recruiter's mail under its own domain, so the domain alone proves nothing;
  // the alerts it also sends still lose on their no-reply local part.
  assert.ok(!automatedSender("shobit@dice.com"));
  assert.ok(automatedSender("no-reply@dice.com"));

  const recruiter = { fromAddress: "recruiter@example.invalid", subject: "Java contract role", preview: "W2 position, remote." };
  assert.ok(worthClassifying(recruiter));
  assert.ok(!worthClassifying({ ...recruiter, fromAddress: "no-reply@example.invalid" }), "An automated sender is dropped before any cost.");
  assert.ok(!worthClassifying({ ...recruiter, subject: "Lunch tomorrow?", preview: "Are you free at noon." }));
});

test("importing needs the mode, the verdict and the confidence together", () => {
  const yes = { isOpportunity: true, confidence: 0.9, reason: "A recruiter offers a Java contract." };
  assert.ok(shouldImport(yes, "on"));
  assert.ok(!shouldImport(yes, "dryrun"), "A dry run records and imports nothing.");
  assert.ok(!shouldImport(yes, "off"));
  assert.ok(!shouldImport({ ...yes, confidence: 0.4 }, "on"), "An unsure verdict waits for the user.");
  assert.ok(!shouldImport({ ...yes, isOpportunity: false }, "on"));
});

test("a scan decision is parsed strictly or refused", () => {
  assert.deepEqual(parseScanDecision({ isOpportunity: true, confidence: 0.8, reason: " A role is offered. " }), {
    isOpportunity: true, confidence: 0.8, reason: "A role is offered.",
  });
  assert.throws(() => parseScanDecision({ isOpportunity: true, confidence: 0.8 }), /schema/);
  assert.throws(() => parseScanDecision({ isOpportunity: true, confidence: 2, reason: "x" }), /confidence/);
  assert.throws(() => parseScanDecision({ isOpportunity: "yes", confidence: 0.8, reason: "x" }), /isOpportunity/);
  assert.throws(() => parseScanDecision({ isOpportunity: true, confidence: 0.8, reason: "x", extra: 1 }), /schema/);
});

test("a spent budget stops the scan at a job email instead of stepping over it", () => {
  const job = { fromAddress: "recruiter@example.invalid", subject: "Java contract role", preview: "W2 position, remote." };
  const chatter = { ...job, subject: "Lunch tomorrow?", preview: "Are you free at noon." };
  assert.ok(!intakeBudgetSpent(job, { classified: 0, imported: 0 }));
  assert.ok(intakeBudgetSpent(job, { classified: MAX_CLASSIFIED_PER_SCAN, imported: 0 }));
  assert.ok(intakeBudgetSpent(job, { classified: 1, imported: MAX_IMPORTED_PER_SCAN }));
  assert.ok(!intakeBudgetSpent(chatter, { classified: MAX_CLASSIFIED_PER_SCAN, imported: MAX_IMPORTED_PER_SCAN }),
    "Mail that would never be judged costs nothing, so it is passed even with no budget left.");
});
