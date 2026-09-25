import assert from "node:assert/strict";
import test from "node:test";
import { JobSourceType } from "../app/generated/prisma/enums";
import { bookmarkletSource, MAX_CAPTURE_LENGTH } from "../lib/bookmarklet";
import { captureKey, captureKeyMatches, capturedText } from "../lib/capture";
import { detectIntakeSource } from "../services/intake-source";

const secret = "fictional-session-secret-at-least-32-characters";

/** Runs the bookmarklet as Safari would, against a fake page, and returns what it tried to open. */
function click(source: string, selection: string, href = "https://www.linkedin.com/groups/12345/") {
  const opened: Array<{ url: string; target: string; features: string }> = [];
  const alerts: string[] = [];
  const body = decodeURI(source.replace(/^javascript:/, ""));
  new Function("getSelection", "location", "window", "alert", body)(
    () => selection,
    { href },
    { open: (url: string, target: string, features: string) => { opened.push({ url, target, features }); } },
    (message: string) => { alerts.push(message); },
  );
  return { opened, alerts };
}

test("the key is fixed per secret and checked without throwing on junk", () => {
  const key = captureKey(secret);
  assert.equal(key, captureKey(secret));
  assert.notEqual(key, captureKey(`${secret}-rotated`), "Rotating SESSION_SECRET retires the bookmarklet.");
  assert.ok(captureKeyMatches(key, secret));
  assert.ok(!captureKeyMatches(`${key.slice(0, -1)}x`, secret));
  assert.ok(!captureKeyMatches(undefined, secret));
  assert.ok(!captureKeyMatches("é".repeat(key.length), secret), "Same length in characters, longer in bytes: refused, not thrown.");
});

test("the bookmarklet sends the selection, the page and the key to /capture in a new tab", () => {
  const key = captureKey(secret);
  const source = bookmarkletSource("http://localhost:3008/", key);
  assert.ok(source.startsWith("javascript:"));
  const post = "Hiring: Java Developer, Walmart, Sunnyvale CA (C2C)\nSend resume to recruiter@example.invalid";
  const { opened, alerts } = click(source, `  ${post}  `);
  assert.deepEqual(alerts, []);
  assert.equal(opened.length, 1);
  assert.equal(opened[0]!.target, "_blank");
  assert.equal(opened[0]!.features, "noopener", "LinkedIn's page must not reach into the tab it opens.");
  const [base, fragment] = opened[0]!.url.split("#");
  assert.equal(base, "http://localhost:3008/capture", "The text travels in the fragment, never the query.");
  const params = new URLSearchParams(fragment);
  assert.equal(params.get("k"), key);
  assert.equal(params.get("t"), post, "What /capture decodes is exactly what was selected.");
  assert.equal(params.get("u"), "https://www.linkedin.com/groups/12345/");
});

test("with nothing selected the bookmarklet explains instead of opening an empty tab", () => {
  const { opened, alerts } = click(bookmarkletSource("http://localhost:3008", "k"), "   ");
  assert.equal(opened.length, 0);
  assert.match(alerts[0] ?? "", /Select the post text first/);
});

test("a long selection is cut to the limit before it becomes a URL", () => {
  const { opened } = click(bookmarkletSource("http://localhost:3008", "k"), "x".repeat(MAX_CAPTURE_LENGTH + 500));
  assert.equal(new URLSearchParams(opened[0]!.url.split("#")[1]).get("t")?.length, MAX_CAPTURE_LENGTH);
});

test("a captured post is marked with its page and read as a LinkedIn source", () => {
  const text = capturedText("  Java Developer, C2C. Email recruiter@example.invalid  ", "https://www.linkedin.com/feed/update/urn:li:activity:1/");
  assert.equal(text, "Java Developer, C2C. Email recruiter@example.invalid\n\nSource: https://www.linkedin.com/feed/update/urn:li:activity:1/");
  assert.equal(detectIntakeSource(text).sourceType, JobSourceType.LINKEDIN_POST);
  assert.equal(capturedText("Post", "javascript:alert(1)"), "Post", "Only an https page is recorded.");
  assert.equal(capturedText("Post", 42), "Post");
});
