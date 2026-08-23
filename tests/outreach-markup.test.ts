import assert from "node:assert/strict";
import test from "node:test";
import { outreachBodyHtml } from "@/services/outreach-markup";

test("outreach markup bolds screening labels and escapes everything else", () => {
  const html = outreachBodyHtml("**Tech Stack:** React, TypeScript\n**Rate:** $80/hr W2");
  assert.equal(html, "<strong>Tech Stack:</strong> React, TypeScript<br>\n<strong>Rate:</strong> $80/hr W2");

  assert.equal(
    outreachBodyHtml("I have **8+ years of frontend experience** building apps."),
    "I have <strong>8+ years of frontend experience</strong> building apps.",
  );
});

test("outreach markup cannot smuggle markup out of a model-written body", () => {
  assert.equal(
    outreachBodyHtml('<img src=x onerror="alert(1)">'),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
  );
  assert.equal(outreachBodyHtml("**<b>Rate:</b>**"), "<strong>&lt;b&gt;Rate:&lt;/b&gt;</strong>");
  assert.equal(outreachBodyHtml("Ford & Sons"), "Ford &amp; Sons");
});

test("outreach markup leaves ambiguous asterisks alone instead of guessing", () => {
  assert.equal(outreachBodyHtml("Rate: **80"), "Rate: **80", "An unclosed marker stays literal.");
  assert.equal(outreachBodyHtml("** spaced **"), "** spaced **", "Padded markers are not emphasis.");
  assert.equal(
    outreachBodyHtml("**Location:**\n**Rate:**"),
    "<strong>Location:</strong><br>\n<strong>Rate:</strong>",
    "Emphasis must not run across a line break.",
  );
});
