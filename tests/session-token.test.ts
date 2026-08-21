import assert from "node:assert/strict";
import test from "node:test";
import { createSessionToken, isSessionTokenValid, passwordsMatch } from "../lib/session-token";

test("session tokens reject expiry and tampering", () => {
  const now = 1_800_000_000_000;
  const token = createSessionToken(now + 60_000, "test-secret");

  assert.equal(isSessionTokenValid(token, "test-secret", now), true);
  assert.equal(isSessionTokenValid(token, "wrong-secret", now), false);
  assert.equal(isSessionTokenValid(`${token}x`, "test-secret", now), false);
  assert.equal(isSessionTokenValid(token, "test-secret", now + 60_001), false);
  assert.equal(passwordsMatch("correct", "correct"), true);
  assert.equal(passwordsMatch("incorrect", "correct"), false);
});
