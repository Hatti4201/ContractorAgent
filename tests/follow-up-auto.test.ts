import assert from "node:assert/strict";
import test from "node:test";
import { autoFollowUpDescription, followUpAutoEnabled, shouldApplyFollowUp } from "../services/follow-up-auto";

const confident = {
  opportunityId: "job-1",
  confidence: 0.9,
  proposedWaitingOn: "Recruiter",
  proposedNextAction: "Wait for the client submission.",
  proposedNextFollowUpAt: new Date("2026-09-15T12:00:00.000Z"),
  followUpAppliedAt: null,
};

test("nothing moves on its own unless it was turned on", () => {
  assert.equal(followUpAutoEnabled(undefined), false);
  assert.equal(followUpAutoEnabled("true"), false, "Anything unrecognised must mean off, never on.");
  assert.equal(followUpAutoEnabled(" ON "), true);
  assert.equal(shouldApplyFollowUp(confident, false), false);
});

test("only a confident, unambiguous, unapplied match may move the follow-up", () => {
  assert.ok(shouldApplyFollowUp(confident, true));
  assert.ok(!shouldApplyFollowUp({ ...confident, opportunityId: null }, true), "An unmatched email waits for the user.");
  assert.ok(!shouldApplyFollowUp({ ...confident, confidence: 0.75 }, true), "Below the bar it is a suggestion, not a fact.");
  assert.ok(!shouldApplyFollowUp({ ...confident, confidence: null }, true));
  assert.ok(!shouldApplyFollowUp({ ...confident, followUpAppliedAt: new Date() }, true), "Applied once is enough.");
  assert.ok(!shouldApplyFollowUp(
    { ...confident, proposedWaitingOn: null, proposedNextAction: null, proposedNextFollowUpAt: null },
    true,
  ), "An email proposing nothing changes nothing.");
});

test("the activity says what moved and what did not", () => {
  const description = autoFollowUpDescription(confident);
  assert.match(description, /without confirmation/);
  assert.match(description, /waiting on Recruiter/);
  assert.match(description, /2026-09-15/);
  // RESTRICTIONS §4 still reserves the stage, and the record has to say so.
  assert.match(description, /Stage is unchanged/);
});
