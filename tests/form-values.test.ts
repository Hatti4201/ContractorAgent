import assert from "node:assert/strict";
import test from "node:test";
import { dateTimeValue, dateValue } from "@/lib/job-values";

test("a touched datetime field still submits successfully", () => {
  const expected = new Date("2026-08-24T17:14:00.000Z");
  // What the field renders, and what a browser sends back once the user has interacted with it.
  assert.deepEqual(dateTimeValue("2026-08-24T17:14"), expected);
  assert.deepEqual(dateTimeValue("2026-08-24T17:14:00"), expected, "Seconds appear as soon as the field is edited.");
  assert.deepEqual(dateTimeValue("2026-08-24T17:14:00.000"), expected, "Some browsers add milliseconds too.");
  assert.deepEqual(dateTimeValue("2026-08-24T17:14:35"), new Date("2026-08-24T17:14:35.000Z"), "A real second is kept, not discarded.");
});

test("an impossible datetime is still refused", () => {
  assert.throws(() => dateTimeValue("2026-13-01T10:00"), /Invalid date and time/, "Month 13 does not exist.");
  assert.throws(() => dateTimeValue("2026-08-24T25:00"), /Invalid date and time/, "Hour 25 does not exist.");
  assert.throws(() => dateTimeValue("2026-02-30T10:00"), /Invalid date and time/, "February has no thirtieth.");
  assert.throws(() => dateTimeValue("2026-08-24 17:14"), /Invalid date and time/, "A space is not the separator.");
  assert.ok(dateTimeValue("") instanceof Date, "An empty field means now, not an error.");
});

test("date fields stay strict", () => {
  assert.deepEqual(dateValue("2026-08-24"), new Date("2026-08-24T12:00:00.000Z"));
  assert.equal(dateValue(""), null);
  assert.throws(() => dateValue("2026-02-30"), /Invalid date/);
});
