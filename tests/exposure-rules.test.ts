import assert from "node:assert/strict";
import test from "node:test";
import { ExposureResult } from "@/app/generated/prisma/enums";
import {
  applicationSucceeded,
  blockerOn,
  decideCard,
  exposureConfigFromEnv,
  isSubmitLabel,
  looksLikeIdentityQuestion,
  pagesToVisit,
  parsePageCount,
  quoteSupported,
  searchUrl,
  settledByHistory,
} from "@/services/exposure-rules";

test("the channel is off unless the user turns it on, with rules/exposure.md 1.0 defaults", () => {
  const config = exposureConfigFromEnv({});
  assert.equal(config.mode, "off");
  assert.equal(config.window.enabled, false);
  assert.equal(config.maxPages, 7);
  assert.equal(config.dailyLimit, 150);
  assert.equal(config.maxConsecutiveFailures, 5);
  assert.deepEqual(config.titleBlacklist, ["QA", "Test", "SDET"]);
  assert.equal(config.executorModel, "gpt-5.6-luna");
  assert.equal(config.supervisorModel, "gpt-5.6-luna");
  assert.equal(exposureConfigFromEnv({ EXPOSURE_MODE: "ON" }).mode, "on");
  assert.equal(exposureConfigFromEnv({ EXPOSURE_MODE: "yes please" }).mode, "off");
});

test("the search is the user's Dice filter expressed as a URL", () => {
  const url = new URL(searchUrl("java", 3));
  assert.equal(url.searchParams.get("q"), "java");
  assert.equal(url.searchParams.get("filters.postedDate"), "ONE");
  assert.equal(url.searchParams.get("filters.employmentType"), "CONTRACTS|THIRD_PARTY");
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
