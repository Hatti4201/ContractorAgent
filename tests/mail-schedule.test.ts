import assert from "node:assert/strict";
import test from "node:test";
import { displayTimeZone, formatDateTime } from "../lib/job-values";
import { isWithinScanWindow, nextScheduledScanAt, scanWindowFromEnv, shouldScanNow } from "@/services/mail-schedule";

const window = scanWindowFromEnv({ APP_TIME_ZONE: "America/Los_Angeles" });

// 2026-08-24 is a Monday. Times below are UTC; Los Angeles is seven hours behind in August.
const mondayEarly = new Date("2026-08-24T12:00:00Z"); // 05:00 local, before the window
const mondayInside = new Date("2026-08-24T14:00:00Z"); // 07:00 local
const mondayLate = new Date("2026-08-25T01:30:00Z"); // 18:30 local, after the window
const saturday = new Date("2026-08-22T18:00:00Z"); // 11:00 local on a weekend

test("the scan window follows the configured wall clock, not UTC", () => {
  assert.equal(isWithinScanWindow(mondayInside, window), true);
  assert.equal(isWithinScanWindow(mondayEarly, window), false, "05:00 local is before the window opens.");
  assert.equal(isWithinScanWindow(mondayLate, window), false, "18:30 local is after the window closes.");
  assert.equal(isWithinScanWindow(saturday, window), false, "Weekends are outside the window.");
  // 12:00 UTC on that Monday is 05:00 in Los Angeles: inside the window by UTC, outside by wall clock.
  assert.equal(isWithinScanWindow(mondayEarly, { ...window, timeZone: "UTC" }), true);
  assert.equal(isWithinScanWindow(mondayEarly, window), false, "The configured zone decides, not UTC.");
});

test("scanning waits five minutes and resumes after a gap instead of bursting", () => {
  assert.equal(shouldScanNow(mondayInside, null, window), true, "A first run inside the window proceeds.");
  assert.equal(
    shouldScanNow(mondayInside, new Date(mondayInside.getTime() - 4 * 60_000), window),
    false,
    "Four minutes is not yet five minutes.",
  );
  assert.equal(shouldScanNow(mondayInside, new Date(mondayInside.getTime() - 5 * 60_000), window), true);
  assert.equal(
    shouldScanNow(mondayInside, new Date("2026-08-20T14:00:00Z"), window),
    true,
    "A long gap runs once now, not once per missed hour.",
  );
  assert.equal(shouldScanNow(saturday, null, window), false, "Outside the window nothing runs.");
  assert.equal(shouldScanNow(mondayInside, null, { ...window, enabled: false }), false);
});

test("timestamps are read in the user's own zone, and a bad zone falls back rather than throwing", () => {
  const sent = new Date("2026-09-11T21:32:00.000Z");
  // 21:32 UTC is the early afternoon in California; showing it as 9:32 PM reads as the wrong day part.
  assert.match(formatDateTime(sent, "America/Los_Angeles"), /2:32\u202fPM|2:32 PM/);
  assert.match(formatDateTime(sent, "UTC"), /9:32\u202fPM|9:32 PM/);
  assert.equal(displayTimeZone("America/Los_Angeles"), "America/Los_Angeles");
  assert.equal(displayTimeZone("UT-8"), "UTC", "An invalid zone must not throw on every screen.");
  assert.equal(displayTimeZone(""), "UTC");
});

test("the next scheduled scan skips the closed window and weekends", () => {
  const afterHours = new Date("2026-08-25T01:30:00Z"); // Monday 18:30 local
  const next = nextScheduledScanAt(afterHours, new Date("2026-08-25T00:30:00Z"), { ...window, intervalMs: 60 * 60_000 });
  assert.equal(next?.toISOString(), "2026-08-25T13:00:00.000Z"); // Tuesday 06:00 local
});
