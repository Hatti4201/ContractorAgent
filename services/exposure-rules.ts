import { ExposureResult } from "@/app/generated/prisma/enums";
import { configuredTimeZone } from "@/services/attention";
import type { ScanWindow } from "@/services/mail-schedule";

// Phase 9 (REQUIREMENTS FR-14, rules/exposure.md). Everything here is a deterministic rule: the
// constitution keeps filtering and stopping out of the model's hands.

export type ExposureMode = "off" | "dryrun" | "on";
export const exposureModes = ["off", "dryrun", "on"] as const;
export const postedDates = ["ONE", "THREE", "SEVEN"] as const;
export type PostedDate = (typeof postedDates)[number];
// Dice's own URL values, read from its filter panel.
export const employmentTypes = ["CONTRACTS", "THIRD_PARTY", "FULLTIME", "PARTTIME"] as const;
export type EmploymentFilter = (typeof employmentTypes)[number];

/** Everything the user may change from the /exposure page (rules/exposure.md 1.1 §8). */
export type ExposureSettings = {
  mode: ExposureMode;
  keywords: string[];
  postedDate: PostedDate;
  employmentTypes: EmploymentFilter[];
  pageRatio: number;
  maxPages: number;
  titleBlacklist: string[];
  companyBlacklist: string[];
  dailyLimit: number;
  perRunLimit: number;
  jobDelaySeconds: number;
  days: number[];
  startHour: number;
  endHour: number;
  intervalMinutes: number;
  maxConsecutiveFailures: number;
  maxStepsPerJob: number;
  executorModel: string;
  supervisorModel: string;
};

export type ExposureConfig = ExposureSettings & { cdpUrl: string; jobDelayMs: number; window: ScanWindow };

type Env = Partial<Record<string, string>>;

function list(value: unknown) {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,\n]/) : [];
  const strings = items.flatMap((item) => (typeof item === "string" || typeof item === "number" ? [String(item).trim()] : []));
  return [...new Set(strings.filter(Boolean))].slice(0, 50);
}

function bounded(value: unknown, fallback: number, low: number, high: number, integer = true) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < low || parsed > high) return fallback;
  return integer ? Math.floor(parsed) : parsed;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T) {
  const text = typeof value === "string" ? value : "";
  return allowed.find((option) => option.toLowerCase() === text.toLowerCase()) ?? fallback;
}

/**
 * Validates settings from any source (the stored row, the page form, .env) against the defaults.
 * An invalid field falls back to its default rather than failing the whole run.
 */
export function parseSettings(value: Record<string, unknown>, defaults: ExposureSettings): ExposureSettings {
  const keywords = list(value.keywords);
  const employment = list(value.employmentTypes).map((type) => oneOf(type, employmentTypes, "CONTRACTS"));
  const days = list(value.days).map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  const text = (field: unknown, fallback: string) => (typeof field === "string" && field.trim() ? field.trim().slice(0, 80) : fallback);
  return {
    mode: oneOf(value.mode, exposureModes, defaults.mode),
    keywords: keywords.length ? keywords : defaults.keywords,
    postedDate: oneOf(value.postedDate, postedDates, defaults.postedDate),
    employmentTypes: employment.length ? [...new Set(employment)] : defaults.employmentTypes,
    pageRatio: bounded(value.pageRatio, defaults.pageRatio, 0.05, 1, false),
    maxPages: bounded(value.maxPages, defaults.maxPages, 1, 50),
    titleBlacklist: value.titleBlacklist === undefined ? defaults.titleBlacklist : list(value.titleBlacklist),
    companyBlacklist: value.companyBlacklist === undefined ? defaults.companyBlacklist : list(value.companyBlacklist),
    dailyLimit: bounded(value.dailyLimit, defaults.dailyLimit, 1, 1000),
    perRunLimit: bounded(value.perRunLimit, defaults.perRunLimit, 1, 1000),
    jobDelaySeconds: bounded(value.jobDelaySeconds, defaults.jobDelaySeconds, 0, 600),
    days: days.length ? [...new Set(days)].sort() : defaults.days,
    startHour: bounded(value.startHour, defaults.startHour, 0, 23),
    endHour: bounded(value.endHour, defaults.endHour, 1, 24),
    intervalMinutes: bounded(value.intervalMinutes, defaults.intervalMinutes, 5, 1440),
    maxConsecutiveFailures: bounded(value.maxConsecutiveFailures, defaults.maxConsecutiveFailures, 1, 50),
    maxStepsPerJob: bounded(value.maxStepsPerJob, defaults.maxStepsPerJob, 3, 40),
    executorModel: text(value.executorModel, defaults.executorModel),
    supervisorModel: text(value.supervisorModel, defaults.supervisorModel),
  };
}

/** The rules/exposure.md initial values, overridable by .env; the page's saved settings sit on top. */
export function defaultSettings(env: Env = process.env): ExposureSettings {
  const base: ExposureSettings = {
    mode: "off",
    keywords: ["java"],
    postedDate: "ONE",
    employmentTypes: ["CONTRACTS", "THIRD_PARTY"],
    pageRatio: 2 / 3,
    maxPages: 7,
    titleBlacklist: ["QA", "Test", "SDET"],
    companyBlacklist: [],
    dailyLimit: 150,
    perRunLimit: 30,
    jobDelaySeconds: 30,
    days: [1, 2, 3, 4, 5],
    startHour: 6,
    endHour: 15,
    intervalMinutes: 60,
    maxConsecutiveFailures: 5,
    maxStepsPerJob: 15,
    executorModel: "gpt-5.6-luna",
    supervisorModel: "gpt-5.6-luna",
  };
  return parseSettings({
    mode: env.EXPOSURE_MODE,
    keywords: env.EXPOSURE_KEYWORDS ?? env.EXPOSURE_KEYWORD,
    postedDate: env.EXPOSURE_POSTED_DATE,
    employmentTypes: env.EXPOSURE_EMPLOYMENT_TYPES,
    pageRatio: env.EXPOSURE_PAGE_RATIO,
    maxPages: env.EXPOSURE_MAX_PAGES,
    titleBlacklist: env.EXPOSURE_TITLE_BLACKLIST,
    companyBlacklist: env.EXPOSURE_COMPANY_BLACKLIST,
    dailyLimit: env.EXPOSURE_DAILY_LIMIT,
    perRunLimit: env.EXPOSURE_PER_RUN_LIMIT,
    jobDelaySeconds: env.EXPOSURE_JOB_DELAY_SECONDS,
    days: env.EXPOSURE_DAYS,
    startHour: env.EXPOSURE_START_HOUR,
    endHour: env.EXPOSURE_END_HOUR,
    intervalMinutes: env.EXPOSURE_INTERVAL_MINUTES,
    maxConsecutiveFailures: env.EXPOSURE_MAX_CONSECUTIVE_FAILURES,
    maxStepsPerJob: env.EXPOSURE_MAX_STEPS_PER_JOB,
    executorModel: env.EXPOSURE_EXECUTOR_MODEL,
    supervisorModel: env.EXPOSURE_SUPERVISOR_MODEL,
  }, base);
}

/** Settings saved from the page win over .env; the Chrome address stays machine-bound in .env. */
export function exposureConfig(stored: unknown, env: Env = process.env): ExposureConfig {
  const defaults = defaultSettings(env);
  const settings = stored && typeof stored === "object" && !Array.isArray(stored) ? parseSettings(stored as Record<string, unknown>, defaults) : defaults;
  return {
    ...settings,
    cdpUrl: (env.EXPOSURE_CDP_URL ?? "http://127.0.0.1:9222").replace(/\/+$/, ""),
    jobDelayMs: settings.jobDelaySeconds * 1000,
    window: {
      enabled: settings.mode !== "off",
      days: settings.days,
      startHour: settings.startHour,
      endHour: settings.endHour,
      intervalMs: settings.intervalMinutes * 60_000,
      timeZone: configuredTimeZone(env.APP_TIME_ZONE),
    },
  };
}

/** The search itself is a URL, so no filter control ever has to be clicked. */
export function searchUrl(keyword: string, page: number, postedDate: PostedDate = "ONE", types: readonly EmploymentFilter[] = ["CONTRACTS", "THIRD_PARTY"]) {
  const params = new URLSearchParams({ q: keyword, "filters.postedDate": postedDate, "filters.employmentType": types.join("|"), "filters.easyApply": "true" });
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

// Status lines Dice mixes into a card. Signed in, "Easy Apply" is hidden and "Applied" sits under the title.
const statusLines = new Set(["applied", "easy apply"]);

/**
 * List-page decision: only what the card can prove. Whether the job is Easy Apply is settled on the job
 * page from the apply button's link, because a signed-in card no longer shows that badge.
 */
export function decideCard(card: JobCard, blacklist: readonly string[], companyBlacklist: readonly string[] = []): CardDecision {
  const title = card.lines[0]?.trim() || "Untitled job";
  const rest = card.lines.slice(1).map((line) => line.trim());
  const company = rest.find((line) => !statusLines.has(line.toLowerCase())) || null;
  if (rest.some((line) => line.toLowerCase() === "applied")) return { apply: false, title, company, reason: "Already applied on Dice." };
  const term = blacklistedTerm(title, blacklist);
  if (term) return { apply: false, title, company, reason: `Title matches blacklist term "${term}".` };
  const blockedCompany = company ? companyBlacklist.find((name) => company.toLowerCase().includes(name.toLowerCase())) : undefined;
  if (blockedCompany) return { apply: false, title, company, reason: `Company matches blacklist "${blockedCompany}".` };
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
 * the user actually wrote down. Whitespace, case and Markdown marks are forgiven; the words are not.
 */
export function quoteSupported(quote: string | null | undefined, facts: string | null) {
  if (!quote?.trim() || !facts) return false;
  // Markdown emphasis and heading marks are formatting, not words, so the model may drop them.
  const normalize = (value: string) => value.replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const needle = normalize(quote);
  return needle.length >= 3 && normalize(facts).includes(needle);
}
