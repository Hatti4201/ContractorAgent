import type { Prisma, PrismaClient } from "@/app/generated/prisma/client";
import { ExposureChannel, ExposureResult } from "@/app/generated/prisma/enums";
import { getPrisma } from "@/lib/prisma";
import { CdpTab, pause } from "@/services/cdp";
import { nextStep, superviseFailure } from "@/services/exposure-agent";
import {
  clickElement,
  fillElement,
  readApplyButton,
  readCards,
  selectOption,
  snapshot,
  waitFor,
} from "@/services/exposure-page";
import {
  applicationSucceeded,
  blockerOn,
  decideCard,
  exposureConfig,
  isSubmitLabel,
  looksLikeIdentityQuestion,
  jobUrl,
  pagesToVisit,
  parsePageCount,
  quoteSupported,
  searchUrl,
  settledByHistory,
  type ExposureConfig,
} from "@/services/exposure-rules";
import { loadOutreachContext } from "@/services/outreach-context";

type Database = PrismaClient | Prisma.TransactionClient;
type Answer = { question: string; kind: string; answer: string; factQuote: string | null };
type JobOutcome =
  | { result: typeof ExposureResult.APPLIED | typeof ExposureResult.DRY_RUN_READY; answers: Answer[] }
  | { result: typeof ExposureResult.SKIPPED; reason: string }
  | { result: typeof ExposureResult.FAILED; reason: string; answers: Answer[]; history: string[]; pageExcerpt: string }
  | { result: "BLOCKED"; reason: string };

const STATE_ID = "primary";
const STEP_PAUSE_MS = 1_500;

export function exposureState(database: Database = getPrisma()) {
  return database.exposureState.upsert({ where: { id: STATE_ID }, create: { id: STATE_ID }, update: {} });
}

export async function priorResults(database: Database, externalId: string) {
  const rows = await database.exposureApplication.findMany({ where: { channel: ExposureChannel.DICE, externalId }, select: { result: true } });
  return rows.map((row) => row.result);
}

// ponytail: "today" is a rolling 24 hours, so the limit can never be exceeded across midnight either.
export function countedToday(database: Database, now = new Date()) {
  return database.exposureApplication.count({
    where: { createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) }, result: { in: [ExposureResult.APPLIED, ExposureResult.DRY_RUN_READY] } },
  });
}

/** Results of the last 24 hours, for the exposure page's daily summary. */
export async function recentCounts(database: Database = getPrisma(), now = new Date()) {
  const rows = await database.exposureApplication.groupBy({
    by: ["result"],
    where: { createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
    _count: true,
  });
  return (result: ExposureResult) => rows.find((row) => row.result === result)?._count ?? 0;
}

/** The last seven days of results, in the chart's result order, stamped with the time they were read. */
export async function weekOfResults(database: Database = getPrisma(), now = new Date()) {
  const order = [ExposureResult.APPLIED, ExposureResult.DRY_RUN_READY, ExposureResult.FAILED, ExposureResult.SKIPPED];
  const rows = await database.exposureApplication.findMany({
    where: { createdAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } },
    select: { createdAt: true, result: true },
  });
  return { now: now.getTime(), events: rows.map((row) => ({ at: row.createdAt.getTime(), result: order.indexOf(row.result) })) };
}

async function checkBlocker(tab: CdpTab) {
  const page = await snapshot(tab);
  const blocker = blockerOn(page);
  return { page, blocker };
}

// ponytail: two soft retries per job for a slow page, a re-rendered control or a slow model; raise if Dice gets slower.
const SOFT_RETRIES = 2;

/**
 * A slow page or a dropped Chrome answer is one job's failure, recorded so the next run retries it,
 * never the end of the whole run. Only a Stop and the hard blockers end a run from here.
 */
async function applyToJob(context: RunContext, guid: string, title: string, onStep: (step: number) => Promise<void>): Promise<JobOutcome> {
  try {
    return await attemptJob(context, guid, title, onStep);
  } catch (error) {
    if (error instanceof StopRequested) throw error;
    return { result: ExposureResult.FAILED, reason: error instanceof Error ? error.message : "The job failed.", answers: [], history: [], pageExcerpt: "" };
  }
}

async function attemptJob(context: RunContext, guid: string, title: string, onStep: (step: number) => Promise<void>): Promise<JobOutcome> {
  const { tab, config, facts } = context;
  await tab.navigate(jobUrl(guid));
  await waitFor(tab, '[data-testid="apply-button"]');
  const opened = await checkBlocker(tab);
  if (opened.blocker) return { result: "BLOCKED", reason: opened.blocker };

  const button = await readApplyButton(tab);
  // The search already asks Dice for Easy Apply only, so a missing button means the page was still loading.
  if (!button) return { result: ExposureResult.FAILED, reason: "The apply button had not loaded; retried next run.", answers: [], history: [], pageExcerpt: "" };
  // Signed out, the button points at the login page; that must stop the run, not skip every job.
  if (button.href && /login|sign-?in/i.test(button.href)) return { result: "BLOCKED", reason: "Dice is signed out. Sign in again in the exposure Chrome window." };
  if (/^applied$/i.test(button.text)) return { result: ExposureResult.SKIPPED, reason: "Already applied on Dice." };
  // rules/exposure.md §2: Easy Apply opens Dice's own wizard; anything else leaves for an outside site.
  if (!button.href?.includes("/job-applications/")) return { result: ExposureResult.SKIPPED, reason: "Applies on an outside site." };
  // Following the button's own link keeps the wizard in this tab even if Dice opens it in a new one.
  await tab.navigate(new URL(button.href, "https://www.dice.com").toString());
  await pause(STEP_PAUSE_MS * 2);

  const answers: Answer[] = [];
  const history: string[] = [];
  let lastUrl = "";
  let pageExcerpt = "";
  let softRetries = 0;
  // The last few steps go into the reason, so a failure can be read without re-running it.
  const failed = (reason: string): JobOutcome => ({
    result: ExposureResult.FAILED,
    reason: [reason, ...history.slice(-3)].join(" | ").slice(0, 900),
    answers,
    history,
    pageExcerpt,
  });
  /** A transient hiccup: note it, look at the page again, and let the model choose afresh. */
  const retry = (note: string) => {
    softRetries += 1;
    history.push(`(retry: ${note})`);
    return softRetries <= SOFT_RETRIES;
  };

  for (let step = 1; step <= config.maxStepsPerJob; step += 1) {
    // Stopping mid-wizard leaves an unsubmitted form behind, which Dice simply discards.
    await context.checkStop();
    await onStep(step);
    const { page, blocker } = await checkBlocker(tab);
    if (blocker) return { result: "BLOCKED", reason: blocker };
    if (applicationSucceeded(page)) return { result: ExposureResult.APPLIED, answers };
    pageExcerpt = page.text.slice(0, 800);
    lastUrl = page.url;

    let move;
    try {
      move = await nextStep(config.executorModel, { jobTitle: title, facts, history, page });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The executor model failed.";
      if (retry(message)) continue;
      return failed(message);
    }
    if (move.action === "give_up") return failed(`Agent gave up: ${move.note}`);

    const target = page.elements.find((element) => element.id === move.target);
    if (!target) {
      if (retry(`chose control ${move.target}, which is not on the page`)) continue;
      return failed(`Agent chose a control that is not on the page (${move.target}).`);
    }

    // RESTRICTIONS §4: a fact or identity answer must rest on words the user actually wrote down.
    // Only answering moves count; pressing Next beside a "Work Authorization" heading answers nothing.
    const answering = move.action === "fill" || move.action === "select" || move.questionKind !== "none" || /radio|checkbox|option|switch/.test(target.kind);
    const questionText = `${move.question ?? ""} ${target.question ?? ""} ${target.label}`;
    const kind = answering && looksLikeIdentityQuestion(questionText) ? "identity" : move.questionKind;
    if ((kind === "identity" || kind === "fact") && !quoteSupported(move.factQuote, facts)) {
      return failed(`Unsupported ${kind} answer to "${move.question ?? target.question ?? target.label}"; left for the user.`);
    }

    const submitting = move.action === "submit" || isSubmitLabel(target.label);
    if (submitting && config.mode === "dryrun") return { result: ExposureResult.DRY_RUN_READY, answers };

    try {
      if (move.action === "fill") await fillElement(tab, target.id, move.value ?? "");
      else if (move.action === "select") await selectOption(tab, target.id, move.value ?? "");
      else await clickElement(tab, target.id);
    } catch (error) {
      // Usually the page re-rendered between reading it and acting on it.
      const message = error instanceof Error ? error.message : "The page action failed.";
      if (retry(message)) continue;
      return failed(message);
    }

    if (kind !== "none") {
      answers.push({ question: move.question ?? target.question ?? target.label, kind, answer: move.value ?? target.label, factQuote: move.factQuote });
    }
    history.push(`${step}. ${move.action} [${target.id}] "${target.label}"${move.value ? ` = "${move.value}"` : ""} — ${move.note}`);
    await pause(submitting ? STEP_PAUSE_MS * 3 : STEP_PAUSE_MS);

    if (submitting) {
      const after = await snapshot(tab);
      if (applicationSucceeded(after)) return { result: ExposureResult.APPLIED, answers };
    }
  }
  return failed(`No submission after ${config.maxStepsPerJob} steps (last page ${lastUrl}).`);
}

async function record(database: Database, data: { guid: string; title: string; company: string | null; result: ExposureResult; reason?: string | null; answers?: Answer[] }) {
  await database.exposureApplication.create({ data: {
    channel: ExposureChannel.DICE,
    externalId: data.guid,
    title: data.title,
    company: data.company,
    url: jobUrl(data.guid),
    result: data.result,
    reason: data.reason ?? null,
    answers: data.answers?.length ? (data.answers as unknown as Prisma.InputJsonValue) : undefined,
  } });
}

export type RunSummary = { applied: number; rehearsed: number; skipped: number; failed: number; stopReason: string | null };

/** The Stop button, honoured between steps: the run ends cleanly, not as a failure. */
class StopRequested extends Error {}

type RunContext = {
  tab: CdpTab;
  config: ExposureConfig;
  facts: string | null;
  summary: RunSummary;
  progress: (line: string) => Promise<void>;
  checkStop: () => Promise<void>;
};

async function runPages(context: RunContext) {
  const { tab, config, summary } = context;
  const database = getPrisma();
  let failuresInARow = 0;
  const seen = new Set<string>();

  for (const keyword of config.keywords) {
    let totalPages = 1;
    for (let pageNumber = 1; pageNumber <= pagesToVisit(totalPages, config.pageRatio, config.maxPages); pageNumber += 1) {
      await context.checkStop();
      const url = searchUrl(keyword, pageNumber, config.postedDate, config.employmentTypes);
      // One retry for a slow search page before the run gives up on it.
      await tab.navigate(url).catch(async () => { await pause(5_000); await tab.navigate(url); });
      await waitFor(tab, '[data-testid="job-card"]');
      const { blocker } = await checkBlocker(tab);
      if (blocker) throw new Error(blocker);
      const { cards, pageLabel } = await readCards(tab);
      if (pageNumber === 1) totalPages = parsePageCount(pageLabel) ?? 1;
      const where = `"${keyword}" · page ${pageNumber} of ${pagesToVisit(totalPages, config.pageRatio, config.maxPages)}`;
      await context.progress(where);

      for (const card of cards) {
        if (seen.has(card.guid)) continue;
        seen.add(card.guid);
        await context.checkStop();
        // Reaching either limit is the plan working, so it ends the run quietly.
        if (summary.applied + summary.rehearsed >= config.perRunLimit) return;
        if (await countedToday(database) >= config.dailyLimit) return;
        if (settledByHistory(await priorResults(database, card.guid), config.mode)) continue;

        const decision = decideCard(card, config.titleBlacklist, config.companyBlacklist);
        if (!decision.apply) {
          await record(database, { guid: card.guid, title: decision.title, company: decision.company, result: ExposureResult.SKIPPED, reason: decision.reason });
          summary.skipped += 1;
          continue;
        }

        const outcome = await applyToJob(context, card.guid, decision.title, (step) => context.progress(`${where} · ${decision.title} · step ${step}`));
        if (outcome.result === "BLOCKED") throw new Error(outcome.reason);

        if (outcome.result === ExposureResult.FAILED) {
          failuresInARow += 1;
          summary.failed += 1;
          await record(database, { guid: card.guid, title: decision.title, company: decision.company, result: outcome.result, reason: outcome.reason, answers: outcome.answers });
          if (failuresInARow >= config.maxConsecutiveFailures) throw new Error(`${failuresInARow} applications failed in a row. Last: ${outcome.reason}`);
          const verdict = await superviseFailure(config.supervisorModel, { jobTitle: decision.title, reason: outcome.reason, history: outcome.history, pageExcerpt: outcome.pageExcerpt, failuresInARow })
            .catch(() => ({ decision: "skip_job" as const, reason: "Supervisor unavailable." }));
          if (verdict.decision === "stop_run") throw new Error(`Supervisor stopped the run: ${verdict.reason}`);
        } else {
          failuresInARow = 0;
          if (outcome.result === ExposureResult.SKIPPED) summary.skipped += 1;
          else if (outcome.result === ExposureResult.APPLIED) summary.applied += 1;
          else summary.rehearsed += 1;
          await record(database, {
            guid: card.guid,
            title: decision.title,
            company: decision.company,
            result: outcome.result,
            reason: outcome.result === ExposureResult.SKIPPED ? outcome.reason : null,
            answers: "answers" in outcome ? outcome.answers : undefined,
          });
          if (outcome.result === ExposureResult.SKIPPED) continue;
        }
        // rules/exposure.md §6: space applications out instead of firing them back to back.
        await context.progress(`${where} · waiting ${config.jobDelaySeconds}s before the next job`);
        await pause(config.jobDelayMs);
      }
    }
  }
}

// ponytail: one run at a time per Node process, which is all a single local app has.
const globalForExposure = globalThis as unknown as { exposureRunning?: boolean };

export function exposureRunning() {
  return Boolean(globalForExposure.exposureRunning);
}

/** The effective settings: what was saved on the /exposure page, on top of the .env defaults. */
export async function loadExposureConfig(database: Database = getPrisma()) {
  return exposureConfig((await exposureState(database)).settings);
}

/** One pass over the configured searches. Returns null when the channel is off or a run is already going. */
export async function runExposure(): Promise<RunSummary | null> {
  const database = getPrisma();
  const config = await loadExposureConfig(database);
  if (config.mode === "off" || globalForExposure.exposureRunning) return null;
  globalForExposure.exposureRunning = true;
  await database.exposureState.update({ where: { id: STATE_ID }, data: { lastRunAt: new Date(), stopRequested: false, progress: "Starting" } });

  const summary: RunSummary = { applied: 0, rehearsed: 0, skipped: 0, failed: 0, stopReason: null };
  let tab: CdpTab | null = null;
  try {
    // Without facts the agent still applies; it just gives up on any fact or identity question.
    const facts = await loadOutreachContext().catch(() => null);
    tab = await CdpTab.open(config.cdpUrl);
    await runPages({
      tab,
      config,
      facts,
      summary,
      progress: async (line) => { await database.exposureState.update({ where: { id: STATE_ID }, data: { progress: line.slice(0, 300) } }); },
      checkStop: async () => {
        const { stopRequested } = await database.exposureState.findUniqueOrThrow({ where: { id: STATE_ID }, select: { stopRequested: true } });
        if (stopRequested) throw new StopRequested();
      },
    });
    await database.exposureState.update({ where: { id: STATE_ID }, data: { lastSuccessAt: new Date(), consecutiveFailures: 0, lastError: null } });
    return summary;
  } catch (error) {
    if (error instanceof StopRequested) {
      summary.stopReason = "Stopped from the exposure page.";
      return summary;
    }
    const message = (error instanceof Error ? error.message : "The exposure run failed.").slice(0, 500);
    summary.stopReason = message;
    // An unattended run has to stay loud when it stops: Needs Attention shows this until a clean run.
    await database.exposureState.update({ where: { id: STATE_ID }, data: { consecutiveFailures: { increment: 1 }, lastError: message } });
    return summary;
  } finally {
    await tab?.close();
    await database.exposureState.update({ where: { id: STATE_ID }, data: { progress: null, stopRequested: false } }).catch(() => {});
    globalForExposure.exposureRunning = false;
    console.log(`Dice exposure (${config.mode}) run: ${summary.applied} applied, ${summary.rehearsed} rehearsed, ${summary.skipped} skipped, ${summary.failed} failed${summary.stopReason ? ` — ${summary.stopReason}` : ""}.`);
  }
}
