import assert from "node:assert/strict";
import test from "node:test";
import { isPhoneQuery, matchSnippet, phoneDigits } from "../services/job-search";

test("a phone number matches however either side was typed", () => {
  assert.equal(phoneDigits("+1 (555) 123-4567"), "15551234567");
  assert.ok(phoneDigits("+1 (555) 123-4567").includes(phoneDigits("555-123-4567")));
  assert.ok(phoneDigits("+1 (555) 123-4567").includes(phoneDigits("4567")), "The last four from a missed call must be enough.");

  assert.ok(isPhoneQuery("(555) 123 4567"));
  assert.ok(isPhoneQuery("4567"));
  assert.ok(!isPhoneQuery("123"), "Three digits would match far too much.");
  assert.ok(!isPhoneQuery("Example Recruiter"), "A name must take the text path, not the digits path.");
});

test("a snippet is a window around the first hit, split for marking", () => {
  const jd = `${"a".repeat(200)} REMOTE contract ${"b".repeat(200)}`;
  const snippet = matchSnippet("JD", jd, "remote");
  if (!snippet) assert.fail("The window must be found regardless of case.");
  assert.equal(snippet.match, "REMOTE", "The original casing is what gets marked.");
  assert.ok(snippet.before.startsWith("…") && snippet.after.endsWith("…"), "A long JD is trimmed on both sides.");
  assert.ok(snippet.before.length < 100 && snippet.after.length < 100);
  assert.equal(matchSnippet("JD", jd, "nothing here"), null);
  assert.equal(matchSnippet("JD", null, "remote"), null);
});
