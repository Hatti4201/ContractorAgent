import assert from "node:assert/strict";
import test from "node:test";
import { ExposureResult } from "@/app/generated/prisma/enums";
import { openAiError } from "@/services/job-analyzer";
import { aiCapacityLabel, isAiCapacityError, unresolvedAiCapacityApplications } from "@/services/ai-capacity";

test("OpenAI quota exhaustion is explicit in the persisted error text", () => {
  const message = openAiError("exposure_step", 429, JSON.stringify({ error: { code: "insufficient_quota" } }));
  assert.match(message, /API quota\/credits exhausted/);
  assert.match(message, /OPENAI_API_QUOTA_EXHAUSTED/);

  assert.match(openAiError("exposure_step", 429, JSON.stringify({ error: { message: "You exceeded your current quota." } })), /API quota\/credits exhausted/);
});

test("OpenAI rate limiting is distinguishable from exhausted quota", () => {
  const message = openAiError("exposure_step", 429, JSON.stringify({ error: { code: "rate_limit_exceeded" } }));
  assert.match(message, /API rate limit reached/);
  assert.match(message, /OPENAI_API_RATE_LIMITED/);
});

test("AI capacity failures are recognized for dashboard recovery", () => {
  assert.equal(isAiCapacityError("OpenAI screening failed: API rate limit reached (HTTP 429) [OPENAI_API_RATE_LIMITED]"), true);
  assert.equal(isAiCapacityError("OpenAI returned invalid structured analysis."), false);
  assert.equal(aiCapacityLabel("[OPENAI_API_QUOTA_EXHAUSTED]"), "AI 额度已用尽");
});

test("a recovered Dice application no longer appears as an AI capacity alert", () => {
  const rows = unresolvedAiCapacityApplications([
    { externalId: "recovered", result: ExposureResult.APPLIED, reason: null },
    { externalId: "recovered", result: ExposureResult.FAILED, reason: "[OPENAI_API_QUOTA_EXHAUSTED]" },
    { externalId: "waiting", result: ExposureResult.FAILED, reason: "[OPENAI_API_RATE_LIMITED]" },
  ]);
  assert.deepEqual(rows.map((row) => row.externalId), ["waiting"]);
});
