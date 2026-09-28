import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAutomatically,
  autoFollowUpDescription,
  autoStageDescription,
  followUpAutoEnabled,
  followUpAutoStageEnabled,
  parseAutoStageChange,
  shouldApplyFollowUp,
  shouldApplyStage,
  undoAutoStageDescription,
  type AutoSuggestion,
} from "../services/follow-up-auto";

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
});

const interview: AutoSuggestion = {
  ...confident,
  id: "sugg-1",
  receivedAt: new Date("2026-09-10T15:00:00.000Z"),
  proposedActivity: "INTERVIEW_SCHEDULED",
  proposedStage: "INTERVIEW_SCHEDULED",
  evidence: [{ quote: "The client would like to interview you Thursday." }],
};

test("the stage switch is separate and off unless turned on", () => {
  assert.equal(followUpAutoStageEnabled(undefined), false);
  assert.equal(followUpAutoStageEnabled("yes"), false);
  assert.equal(followUpAutoStageEnabled("on"), true);
  assert.ok(!shouldApplyStage(interview, "SUBMITTED_TO_CLIENT", false));
});

test("a stage moves on its own only forward, into an allowed stage, with evidence", () => {
  assert.ok(shouldApplyStage(interview, "SUBMITTED_TO_CLIENT", true));
  assert.ok(!shouldApplyStage(interview, "INTERVIEW_SCHEDULED", true), "Same stage is no move.");
  assert.ok(!shouldApplyStage(interview, "OFFER", true), "Never backwards.");
  assert.ok(!shouldApplyStage(interview, "NO_RESPONSE", true), "A terminal current stage never moves on its own.");
  assert.ok(!shouldApplyStage({ ...interview, proposedStage: "REJECTED" }, "SUBMITTED_TO_CLIENT", true), "Terminal stages wait for the user.");
  assert.ok(!shouldApplyStage({ ...interview, proposedStage: "ROLE_CLOSED" }, "SUBMITTED_TO_CLIENT", true));
  assert.ok(!shouldApplyStage({ ...interview, confidence: 0.7 }, "SUBMITTED_TO_CLIENT", true));
  assert.ok(!shouldApplyStage({ ...interview, opportunityId: null }, "SUBMITTED_TO_CLIENT", true));
  assert.ok(!shouldApplyStage({ ...interview, evidence: [] }, "SUBMITTED_TO_CLIENT", true), "No quote, no move.");
});

test("the undo can read back exactly what the scan wrote", () => {
  const description = autoStageDescription("SUBMITTED_TO_CLIENT", "INTERVIEW_SCHEDULED", "sugg-1");
  assert.deepEqual(parseAutoStageChange(description), { from: "SUBMITTED_TO_CLIENT", to: "INTERVIEW_SCHEDULED" });
  assert.equal(parseAutoStageChange("Stage changed from SUBMITTED_TO_CLIENT to INTERVIEW_SCHEDULED after human confirmation."), null, "A confirmed change is not undoable here.");
  assert.equal(parseAutoStageChange("Stage changed from NOPE to OFFER automatically from Outlook follow-up suggestion x."), null);
  assert.match(undoAutoStageDescription("act-9", { from: "SUBMITTED_TO_CLIENT", to: "INTERVIEW_SCHEDULED" }), /act-9/);
});

function fakeDatabase(currentStage: string) {
  const calls: { track?: Record<string, unknown>; activities: Record<string, unknown>[]; suggestion?: Record<string, unknown> } = { activities: [] };
  const database = {
    applicationTrack: {
      findUnique: async () => ({ currentStage }),
      update: async ({ data }: { data: Record<string, unknown> }) => { calls.track = data; },
    },
    activity: { createMany: async ({ data }: { data: Record<string, unknown>[] }) => { calls.activities.push(...data); } },
    followUpSuggestion: { update: async ({ data }: { data: Record<string, unknown> }) => { calls.suggestion = data; } },
  };
  return { database: database as never, calls };
}

test("everything applied: the suggestion leaves the queue with a trail", async () => {
  const { database, calls } = fakeDatabase("SUBMITTED_TO_CLIENT");
  const outcome = await applyAutomatically(database, interview, { fields: true, stage: true });
  assert.deepEqual(outcome, { fields: true, stage: true, resolved: true });
  assert.equal(calls.track?.currentStage, "INTERVIEW_SCHEDULED");
  assert.deepEqual(calls.activities.map((row) => row.type), ["NOTE", "INTERVIEW_SCHEDULED", "STAGE_CHANGED"]);
  assert.ok(parseAutoStageChange(String(calls.activities[2].description)), "The stage entry must stay undoable.");
  assert.equal(calls.suggestion?.status, "CONFIRMED");
});

test("a terminal stage keeps the suggestion pending while the follow-up still moves", async () => {
  const { database, calls } = fakeDatabase("SUBMITTED_TO_CLIENT");
  const outcome = await applyAutomatically(database, { ...interview, proposedActivity: "NOTE", proposedStage: "REJECTED" }, { fields: true, stage: true });
  assert.deepEqual(outcome, { fields: true, stage: false, resolved: false });
  assert.equal(calls.track?.currentStage, undefined);
  assert.equal(calls.suggestion?.status, undefined);
});

test("with the stage switch off, a proposed stage waits for the user", async () => {
  const { database, calls } = fakeDatabase("SUBMITTED_TO_CLIENT");
  const outcome = await applyAutomatically(database, interview, { fields: true, stage: false });
  assert.deepEqual(outcome, { fields: true, stage: false, resolved: false });
  assert.equal(calls.track?.currentStage, undefined);
});

test("an email proposing nothing is dismissed, not confirmed", async () => {
  const { database, calls } = fakeDatabase("SUBMITTED_TO_CLIENT");
  const nothing = { ...interview, proposedActivity: null, proposedStage: null, proposedWaitingOn: null, proposedNextAction: null, proposedNextFollowUpAt: null };
  const outcome = await applyAutomatically(database, nothing, { fields: true, stage: false });
  assert.deepEqual(outcome, { fields: false, stage: false, resolved: true });
  assert.equal(calls.activities.length, 0);
  assert.equal(calls.suggestion?.status, "DISMISSED");
});

test("both switches off: nothing is touched", async () => {
  const { database, calls } = fakeDatabase("SUBMITTED_TO_CLIENT");
  assert.deepEqual(await applyAutomatically(database, interview, { fields: false, stage: false }), { fields: false, stage: false, resolved: false });
  assert.equal(calls.suggestion, undefined);
});
