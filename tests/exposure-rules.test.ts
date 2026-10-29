import assert from "node:assert/strict";
import test from "node:test";
import { ExposureResult } from "@/app/generated/prisma/enums";
import { exposureDayStart } from "@/services/exposure-run";
import {
  applicationSucceeded,
  blockerOn,
  decideCard,
  defaultSettings,
  exposureConfig,
  isExpectedExposureStop,
  isExposureDailyLimitReason,
  isExposureBlockerReason,
  parseSettings,
  isSubmitLabel,
  looksLikeIdentityQuestion,
  pagesToVisit,
  parsePageCount,
  quoteSupported,
  randomExposureDelayMs,
  searchUrl,
  settledByHistory,
} from "@/services/exposure-rules";

test("the channel is off unless the user turns it on, with rules/exposure.md 1.1 defaults", () => {
  const config = exposureConfig(null, {});
  assert.equal(config.mode, "off");
  assert.equal(config.window.enabled, false);
  assert.deepEqual(config.keywords, ["java"]);
  assert.deepEqual(config.profileBatches, [{ roleFamily: "JAVA_BACKEND", keywords: ["java"] }]);
  assert.equal(config.postedDate, "ONE");
  assert.deepEqual(config.employmentTypes, ["CONTRACTS", "THIRD_PARTY"]);
  assert.equal(config.maxPages, 7);
  assert.equal(config.dailyLimit, 150);
  assert.equal(config.perRunLimit, 30);
  assert.equal(config.maxConsecutiveFailures, 5);
  assert.deepEqual(config.titleBlacklist, ["QA", "Test", "SDET"]);
  assert.deepEqual(config.companyBlacklist, []);
  assert.equal(config.executorModel, "gpt-5.6-luna");
  assert.equal(exposureConfig(null, { EXPOSURE_MODE: "ON" }).mode, "on");
  assert.equal(exposureConfig(null, { EXPOSURE_MODE: "yes please" }).mode, "off");
});

test("the Dice daily limit resets at 5:00 AM in the configured timezone", () => {
  const beforeReset = exposureDayStart(new Date("2026-10-02T11:59:59Z"), "America/Los_Angeles");
  const afterReset = exposureDayStart(new Date("2026-10-02T12:00:00Z"), "America/Los_Angeles");
  assert.equal(beforeReset.toISOString(), "2026-10-01T12:00:00.000Z");
  assert.equal(afterReset.toISOString(), "2026-10-02T12:00:00.000Z");
});

test("Dice application delays are randomized from 30 to 120 seconds", () => {
  assert.equal(randomExposureDelayMs(30, 0), 30_000);
  assert.equal(randomExposureDelayMs(30, 1), 120_000);
  assert.equal(randomExposureDelayMs(60, 0), 60_000);
  assert.equal(randomExposureDelayMs(0, 0), 30_000);
});

test("settings saved on the page win over .env, and bad values fall back instead of breaking a run", () => {
  const env = { EXPOSURE_MODE: "dryrun", EXPOSURE_DAILY_LIMIT: "80" };
  const config = exposureConfig({ mode: "on", keywords: ["java", "spring boot"], dailyLimit: 40, startHour: 9, endHour: 17, days: [1, 3] }, env);
  assert.equal(config.mode, "on");
  assert.deepEqual(config.keywords, ["java"]);
  assert.deepEqual(config.profileBatches, [{ roleFamily: "JAVA_BACKEND", keywords: ["java"] }]);
  assert.equal(config.dailyLimit, 40);
  assert.deepEqual([config.window.startHour, config.window.endHour, config.window.days], [9, 17, [1, 3]]);
  assert.deepEqual(exposureConfig({ profileBatches: [{ roleFamily: "REACT", keywords: ["react"] }, { roleFamily: "PYTHON_AI", keywords: ["python"] }] }, env).profileBatches, [{ roleFamily: "JAVA_BACKEND", keywords: ["java"] }]);
  const defaults = defaultSettings(env);
  const parsed = parseSettings({ mode: "sometimes", dailyLimit: -5, postedDate: "YESTERDAY", employmentTypes: [], keywords: " , ", titleBlacklist: "" }, defaults);
  assert.equal(parsed.mode, "dryrun");
  assert.equal(parsed.dailyLimit, 80);
  assert.equal(parsed.postedDate, "ONE");
  assert.deepEqual(parsed.employmentTypes, ["CONTRACTS", "THIRD_PARTY"]);
  assert.deepEqual(parsed.keywords, ["java"]);
  // An emptied blacklist is a real choice, not a missing value.
  assert.deepEqual(parsed.titleBlacklist, []);
});

test("the search is the configured Dice filter expressed as a URL, Easy Apply only", () => {
  const url = new URL(searchUrl("java", 3, "THREE", ["CONTRACTS", "FULLTIME"]));
  assert.equal(url.searchParams.get("q"), "java");
  assert.equal(url.searchParams.get("filters.postedDate"), "THREE");
  assert.equal(url.searchParams.get("filters.employmentType"), "CONTRACTS|FULLTIME");
  assert.equal(url.searchParams.get("filters.easyApply"), "true");
  assert.equal(url.searchParams.get("page"), "3");
  assert.equal(new URL(searchUrl("java", 1)).searchParams.has("page"), false);
});

test("two thirds of the pages, capped", () => {
  assert.equal(parsePageCount("Page 1 of 10"), 10);
  assert.equal(parsePageCount(null), null);
  assert.equal(pagesToVisit(10, 2 / 3, 7), 7);
  assert.equal(pagesToVisit(9, 2 / 3, 7), 6);
  assert.equal(pagesToVisit(1, 2 / 3, 7), 1);
  assert.equal(pagesToVisit(30, 2 / 3, 7), 7);
  assert.equal(pagesToVisit(0, 2 / 3, 7), 0);
});

test("cards: already-applied and blacklisted titles are skipped; Easy Apply is left to the job page", () => {
  const blacklist = ["QA", "Test", "SDET"];
  // Signed-in cards as Dice renders them: no visible "Easy Apply", and "Applied" right under the title.
  const card = (...lines: string[]) => ({ guid: "g", lines });
  const open = decideCard(card("Sr Java Developer", "Fictional Co", "Remote • Today", "Third Party, Contract"), blacklist);
  assert.equal(open.apply, true);
  assert.equal(open.company, "Fictional Co");
  const applied = decideCard(card("C# Java Developer", "Applied", "Fictional Co", "Remote • Today"), blacklist);
  assert.equal(applied.apply, false);
  assert.equal(applied.company, "Fictional Co");
  assert.equal(decideCard(card("Senior Software Developer Engineer in Testing (SDET)", "Fictional Co"), blacklist).apply, false);
  assert.equal(decideCard(card("Java QA Automation Engineer", "Fictional Co"), blacklist).apply, false);
  assert.equal(decideCard(card("Java Tester", "Fictional Co"), blacklist).apply, false);
  // A blacklist term inside another word must not knock out a real match.
  assert.equal(decideCard(card("Java Developer - Latest Stack", "Fictional Co"), blacklist).apply, true);
  assert.equal(decideCard(card("Java Developer", "Fictional Staffing LLC"), blacklist, ["fictional staffing"]).apply, false);
});

test("history: a dry run never counts as having applied", () => {
  assert.equal(settledByHistory([], "on"), false);
  assert.equal(settledByHistory([ExposureResult.APPLIED], "on"), true);
  assert.equal(settledByHistory([ExposureResult.SKIPPED], "dryrun"), true);
  assert.equal(settledByHistory([ExposureResult.DRY_RUN_READY], "dryrun"), true);
  assert.equal(settledByHistory([ExposureResult.DRY_RUN_READY], "on"), false);
  assert.equal(settledByHistory([ExposureResult.FAILED], "on"), false);
  assert.equal(settledByHistory([ExposureResult.FAILED, ExposureResult.FAILED], "on"), true);
});

test("a login page or a human check stops the run", () => {
  const page = (url: string, text = "", frameSources: string[] = []) => ({ url, text, frameSources });
  assert.match(blockerOn(page("https://www.dice.com/dashboard/login?redirectUrl=x")) ?? "", /login/);
  assert.match(blockerOn(page("https://www.dice.com/jobs", "Please verify you are human")) ?? "", /human check/);
  assert.match(blockerOn(page("https://www.dice.com/jobs", "", ["https://www.google.com/recaptcha/api2/anchor"])) ?? "", /human check/);
  assert.equal(blockerOn(page("https://www.dice.com/job-applications/abc/wizard", "Resume & Cover Letter")), null);
});

test("login and human-check messages are resumable pauses", () => {
  assert.equal(isExposureBlockerReason("Dice asked for a login. Sign in again in the exposure Chrome window."), true);
  assert.equal(isExposureBlockerReason("Dice showed a human check. Solve it in the exposure Chrome window, then run again."), true);
  assert.equal(isExposureBlockerReason("Chrome did not answer Page.navigate in time after 3 attempts."), true);
  assert.equal(isExposureBlockerReason("Supervisor stopped the run: Chrome failed to respond to navigation, indicating a browser-wide issue."), true);
  assert.equal(isExposureBlockerReason("The apply button had not loaded; retried next run."), false);
});

test("expected Dice pauses are round endings, while browser failures stay failures", () => {
  assert.equal(isExpectedExposureStop("Per-run limit reached (30). The next run will continue."), true);
  assert.equal(isExpectedExposureStop("Dice's daily application limit was reached."), true);
  assert.equal(isExposureDailyLimitReason("Application cannot be submitted because Dice's daily application limit has been reached."), true);
  assert.equal(isExpectedExposureStop("Chrome did not answer Page.navigate in time after 3 attempts."), false);
});

test("success is Dice's own confirmation, and submit is recognised whatever the model calls it", () => {
  assert.equal(applicationSucceeded({ url: "https://www.dice.com/job-applications/abc/wizard/success", text: "" }), true);
  assert.equal(applicationSucceeded({ url: "https://www.dice.com/x", text: "Awesome! Your application is on its way!" }), true);
  assert.equal(applicationSucceeded({ url: "https://www.dice.com/job-applications/abc/wizard", text: "Review your application" }), false);
  assert.equal(isSubmitLabel("Submit"), true);
  assert.equal(isSubmitLabel("Submit application"), true);
  assert.equal(isSubmitLabel("Next"), false);
});

test("fact and identity answers must quote the candidate facts verbatim", () => {
  // Fictional placeholder facts; never a real candidate's status.
  const facts = "Work authorization: Example Status Alpha.\nYears of Java experience: 99 (fictional).";
  assert.equal(quoteSupported("Example   Status Alpha", facts), true);
  const markdownFacts = "**Work Authorization:** Example Status Alpha\n## Years\n99 (fictional)";
  assert.equal(quoteSupported("Work Authorization: Example Status Alpha", markdownFacts), true);
  assert.equal(quoteSupported("Work Authorization: Example Status Beta", markdownFacts), false);
  assert.equal(quoteSupported("Example Status Beta", facts), false);
  assert.equal(quoteSupported("", facts), false);
  assert.equal(quoteSupported("Years of Java experience: 99 (fictional).", null), false);
});

test("identity questions are recognised by their wording, not by the model's label", () => {
  assert.equal(looksLikeIdentityQuestion("Are you a US Citizen or Green Card holder?"), true);
  assert.equal(looksLikeIdentityQuestion("Are you legally authorized to work in the United States?"), true);
  assert.equal(looksLikeIdentityQuestion("Will you now or in the future require sponsorship?"), true);
  assert.equal(looksLikeIdentityQuestion("Current visa status"), true);
  assert.equal(looksLikeIdentityQuestion("Are you willing to work onsite 3 days a week?"), false);
  assert.equal(looksLikeIdentityQuestion("Years of Java experience"), false);
});

test("pausing the schedule stops only the hourly runs, not the mode", () => {
  const paused = exposureConfig({ mode: "dryrun", scheduleEnabled: false }, {});
  assert.equal(paused.mode, "dryrun");
  assert.equal(paused.window.enabled, false);
  assert.equal(exposureConfig({ mode: "dryrun" }, {}).window.enabled, true);
  assert.equal(exposureConfig({ mode: "off", scheduleEnabled: true }, {}).window.enabled, false);
  assert.equal(parseSettings({ scheduleEnabled: "no" }, defaultSettings({})).scheduleEnabled, true);
});
