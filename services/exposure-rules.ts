import { ExposureResult } from "@/app/generated/prisma/enums";
import { scanWindowFromEnv, type ScanWindow } from "@/services/mail-schedule";

// Phase 9 (REQUIREMENTS FR-14, rules/exposure.md). Everything here is a deterministic rule: the
// constitution keeps filtering and stopping out of the model's hands.

export type ExposureMode = "off" | "dryrun" | "on";

export type ExposureConfig = {
  mode: ExposureMode;
  cdpUrl: string;
  keyword: string;
  pageRatio: number;
  maxPages: number;
  titleBlacklist: string[];
  dailyLimit: number;
  maxConsecutiveFailures: number;
  maxStepsPerJob: number;
  jobDelayMs: number;
  executorModel: string;
  supervisorModel: string;
  window: ScanWindow;
};

function number(value: string | undefined, fallback: number, low: number, high: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= low && parsed <= high ? parsed : fallback;
}

/** Initial values are the ones rules/exposure.md 1.0 names; every one of them is the user's to change. */
export function exposureConfigFromEnv(env: Partial<Record<string, string>> = process.env): ExposureConfig {
  const rawMode = (env.EXPOSURE_MODE ?? "off").toLowerCase();
  const mode: ExposureMode = rawMode === "on" || rawMode === "dryrun" ? rawMode : "off";
  const blacklist = (env.EXPOSURE_TITLE_BLACKLIST ?? "QA,Test,SDET").split(",").map((term) => term.trim()).filter(Boolean);
  return {
    mode,
    cdpUrl: (env.EXPOSURE_CDP_URL ?? "http://127.0.0.1:9222").replace(/\/+$/, ""),
    keyword: env.EXPOSURE_KEYWORD?.trim() || "java",
    pageRatio: number(env.EXPOSURE_PAGE_RATIO, 2 / 3, 0.05, 1),
    maxPages: Math.floor(number(env.EXPOSURE_MAX_PAGES, 7, 1, 50)),
    titleBlacklist: blacklist,
    dailyLimit: Math.floor(number(env.EXPOSURE_DAILY_LIMIT, 150, 1, 1000)),
    maxConsecutiveFailures: Math.floor(number(env.EXPOSURE_MAX_CONSECUTIVE_FAILURES, 5, 1, 50)),
    maxStepsPerJob: Math.floor(number(env.EXPOSURE_MAX_STEPS_PER_JOB, 15, 3, 40)),
    jobDelayMs: number(env.EXPOSURE_JOB_DELAY_SECONDS, 30, 0, 600) * 1000,
    executorModel: env.EXPOSURE_EXECUTOR_MODEL?.trim() || "gpt-5.6-luna",
    supervisorModel: env.EXPOSURE_SUPERVISOR_MODEL?.trim() || "gpt-5.6-luna",
    window: { ...scanWindowFromEnv(env, "EXPOSURE"), enabled: mode !== "off" },
  };
}

/** The search itself is a URL, so no filter control ever has to be clicked. */
export function searchUrl(keyword: string, page: number) {
  const params = new URLSearchParams({ q: keyword, "filters.postedDate": "ONE", "filters.employmentType": "CONTRACTS|THIRD_PARTY" });
  if (page > 1) params.set("page", String(page));
  return `https://www.dice.com/jobs?${params}`;
}

export function jobUrl(guid: string) {
  return `https://www.dice.com/job-detail/${guid}`;
}

/** Reads the "Page 1 of 10" label under the results. */
export function parsePageCount(label: string | null | undefined) {
  const match = label?.match(/of\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

export function pagesToVisit(totalPages: number, ratio: number, maxPages: number) {
  if (totalPages < 1) return 0;
  return Math.min(maxPages, totalPages, Math.max(1, Math.ceil(totalPages * ratio)));
}

export type JobCard = { guid: string; lines: string[] };

export type CardDecision =
  | { apply: true; title: string; company: string | null }
  | { apply: false; title: string; company: string | null; reason: string };

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Terms match at a word start, so "Test" also catches "Tester" and "Testing" but not "Latest". */
export function blacklistedTerm(title: string, blacklist: readonly string[]) {
  return blacklist.find((term) => new RegExp(`\\b${escapeRegExp(term)}`, "i").test(title)) ?? null;
}

/** A card's lines run title, company, location, then badges such as "Easy Apply" or "Applied". */
export function decideCard(card: JobCard, blacklist: readonly string[]): CardDecision {
  const title = card.lines[0]?.trim() || "Untitled job";
  const company = card.lines[1]?.trim() || null;
  const badges = card.lines.map((line) => line.trim().toLowerCase());
  if (badges.includes("applied")) return { apply: false, title, company, reason: "Already applied on Dice." };
  if (!badges.includes("easy apply")) return { apply: false, title, company, reason: "Not Easy Apply." };
  const term = blacklistedTerm(title, blacklist);
  if (term) return { apply: false, title, company, reason: `Title matches blacklist term "${term}".` };
  return { apply: true, title, company };
}

// ponytail: two failed attempts per job, then it stays skipped; raise if Dice is flaky rather than the job.
export const MAX_ATTEMPTS_PER_JOB = 2;

/**
 * Whether earlier records already settle this job. A dry run does not settle a real run: once the
 * user switches to "on", every rehearsed job is applied for real.
 */
export function settledByHistory(results: readonly ExposureResult[], mode: ExposureMode) {
  if (results.includes(ExposureResult.APPLIED) || results.includes(ExposureResult.SKIPPED)) return true;
  if (mode === "dryrun" && results.includes(ExposureResult.DRY_RUN_READY)) return true;
  return results.filter((result) => result === ExposureResult.FAILED).length >= MAX_ATTEMPTS_PER_JOB;
}

/** A login page or a human check ends the whole run: rules/exposure.md §5, RESTRICTIONS §3. */
export function blockerOn(page: { url: string; text: string; frameSources: readonly string[] }) {
  if (/\/(dashboard\/)?(login|sign-?in)\b/i.test(new URL(page.url).pathname)) return "Dice asked for a login. Sign in again in the exposure Chrome window.";
  const challenge = /captcha|verify (that )?you are (a )?human|are you a robot|press (and|&) hold/i;
  if (challenge.test(page.text) || page.frameSources.some((source) => /recaptcha|hcaptcha|turnstile|challenges\.cloudflare/i.test(source))) {
    return "Dice showed a human check. Solve it in the exposure Chrome window, then run again.";
  }
  return null;
}

export function applicationSucceeded(page: { url: string; text: string }) {
  return /\/wizard\/success/.test(page.url) || /application is on its way/i.test(page.text);
}

/** Whatever the model calls it, pressing one of these is the submission a dry run must not make. */
export function isSubmitLabel(label: string) {
  return /\bsubmit\b|\bsend application\b/i.test(label);
}

/**
 * RESTRICTIONS §4 cannot rest on the model classifying its own question: anything that reads like
 * citizenship, residence, authorization or sponsorship is treated as identity whatever it was called.
 */
export function looksLikeIdentityQuestion(text: string) {
  return /citizen|green\s*card|permanent\s*resident|work\s*authori[sz]|authori[sz]ed\s+to\s+work|legally\s+(eligible|able)|sponsor|visa|\bh-?1b\b|\bead\b|\bopt\b|clearance/i.test(text);
}

/**
 * A fact or identity answer must quote the candidate facts verbatim, so the model can cite only what
 * the user actually wrote down. Whitespace and case are forgiven; nothing else is.
 */
export function quoteSupported(quote: string | null | undefined, facts: string | null) {
  if (!quote?.trim() || !facts) return false;
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
  const needle = normalize(quote);
  return needle.length >= 3 && normalize(facts).includes(needle);
}
