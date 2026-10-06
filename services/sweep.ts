import { Prisma } from "@/app/generated/prisma/client";
import { IntakeStatus, JobSourceType, SweepOutcome, SweepStatus, TaskKind, TaskStatus } from "@/app/generated/prisma/enums";
import { pooled } from "@/lib/pooled";
import { obviousNoise, postIntakeText, splitFeed, type FeedPost } from "@/lib/linkedin-feed";
import { getPrisma } from "@/lib/prisma";
import { parseIntakePreview, runIntakePipeline } from "@/services/intake-pipeline";
import { jobFingerprint } from "@/services/job-case";
import { TRIAGE_BATCH_SIZE, triagePosts, type TriagedPost } from "@/services/post-triage";
import { activeRoleFamilies } from "@/services/role-family";
import { noiseVerdict, postFingerprint, sweepItemState, sweepVerdict, type SweepVerdict } from "@/services/sweep-plan";
import { runTaskNow } from "@/services/tasks";

// Few enough at once to stay inside OpenAI's rate limits; each job is four or five calls.
const PIPELINE_CONCURRENCY = 3;
const SCREEN_CONCURRENCY = 2;
// A sweep reports progress at least this often while it runs; one silent for longer died with the server.
const STALE_SWEEP_MS = 30 * 60_000;

export class SweepInputError extends Error {}

/**
 * Splits the pasted page, records the sweep, and screens and prepares its posts behind the response.
 * Posts already judged in an earlier sweep are counted and left alone, so pasting overlapping pages
 * day after day costs nothing twice.
 */
export async function startSweep(text: string, defer: (run: () => Promise<void>) => void) {
  const posts = splitFeed(text);
  if (!posts.length) throw new SweepInputError("No LinkedIn posts were found. Copy the whole page (Cmd+A, Cmd+C) from a group feed or its search results.");
  const sweep = await getPrisma().sweep.create({ data: { postCount: posts.length, progress: "Screening posts" }, select: { id: true } });
  defer(async () => {
    try {
      await runSweep(sweep.id, posts);
      await getPrisma().sweep.update({ where: { id: sweep.id }, data: { status: SweepStatus.DONE, progress: null } });
    } catch (error) {
      const reason = (error instanceof Error ? error.message : "The sweep failed.").slice(0, 500);
      await getPrisma().sweep.update({ where: { id: sweep.id }, data: { status: SweepStatus.FAILED, progress: null, error: reason } }).catch(() => {});
    }
  });
  return sweep.id;
}

function uniqueConstraint(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

async function runSweep(sweepId: string, pasted: FeedPost[]) {
  const database = getPrisma();
  const progress = (value: string) => database.sweep.update({ where: { id: sweepId }, data: { progress: value.slice(0, 100) } });

  const byFingerprint = new Map<string, FeedPost>();
  for (const post of pasted) byFingerprint.set(postFingerprint(post), post);
  // A post whose screening failed last time is tried again rather than counted as seen.
  await database.sweepPost.deleteMany({ where: { fingerprint: { in: [...byFingerprint.keys()] }, outcome: SweepOutcome.FAILED } });
  const seen = new Set((await database.sweepPost.findMany({
    where: { fingerprint: { in: [...byFingerprint.keys()] } },
    select: { fingerprint: true },
  })).map((post) => post.fingerprint));
  const fresh = [...byFingerprint].filter(([fingerprint]) => !seen.has(fingerprint));
  await database.sweep.update({ where: { id: sweepId }, data: { repeats: pasted.length - fresh.length } });

  const record = async (fingerprint: string, post: FeedPost, verdict: SweepVerdict | { outcome: "FAILED"; reason: string }, triaged: TriagedPost | null) => {
    try {
      return await database.sweepPost.create({
        data: {
          sweepId,
          fingerprint,
          author: post.author,
          profileUrl: post.profileUrl,
          postUrl: post.postUrl ?? null,
          headline: post.headline,
          text: post.body,
          title: triaged?.title ?? null,
          email: triaged?.recruiterEmail ?? null,
          outcome: verdict.outcome,
          reason: verdict.reason.slice(0, 500),
        },
        select: { id: true },
      });
    } catch (error) {
      // Another sweep running at the same time took this post first.
      if (uniqueConstraint(error)) return null;
      throw error;
    }
  };

  const toScreen: Array<[string, FeedPost]> = [];
  for (const [fingerprint, post] of fresh) {
    const noise = obviousNoise(post.body);
    if (noise) await record(fingerprint, post, noiseVerdict(noise), null);
    else toScreen.push([fingerprint, post]);
  }

  const batches: Array<Array<[string, FeedPost]>> = [];
  for (let start = 0; start < toScreen.length; start += TRIAGE_BATCH_SIZE) batches.push(toScreen.slice(start, start + TRIAGE_BATCH_SIZE));
  const roleFamilies = await activeRoleFamilies();
  const queued: Array<{ postId: string; post: FeedPost; triaged: TriagedPost; verdict: Extract<SweepVerdict, { outcome: "QUEUED" }> }> = [];
  let screened = 0;
  await progress(`Screening ${toScreen.length} new posts`);
  await pooled(batches, SCREEN_CONCURRENCY, async (batch) => {
    let results: TriagedPost[];
    try {
      results = await triagePosts(batch.map(([, post]) => post.body), roleFamilies);
    } catch (error) {
      const reason = `Screening failed: ${error instanceof Error ? error.message : "unknown error"} Paste the page again to retry.`;
      for (const [fingerprint, post] of batch) await record(fingerprint, post, { outcome: "FAILED", reason }, null);
      return;
    }
    for (const [index, [fingerprint, post]] of batch.entries()) {
      const triaged = results[index]!;
      const verdict = sweepVerdict(triaged);
      const created = await record(fingerprint, post, verdict, triaged);
      if (created && verdict.outcome === "QUEUED") queued.push({ postId: created.id, post, triaged, verdict });
    }
    screened += batch.length;
    await progress(`Screened ${screened} of ${toScreen.length} new posts`);
  });

  const intakes: Array<{ id: string; title: string }> = [];
  for (const item of queued) {
    const rawText = postIntakeText(item.post);
    const intake = await database.jobIntake.create({
      data: {
        sourceType: JobSourceType.LINKEDIN_POST,
        rawText,
        originalSender: null,
        receivedAt: new Date(),
        fingerprint: jobFingerprint(rawText),
        policy: { facts: item.triaged.facts, decision: item.verdict.decision } as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    await database.sweepPost.update({ where: { id: item.postId }, data: { intakeId: intake.id } });
    intakes.push({ id: intake.id, title: item.triaged.title ?? item.post.author });
  }

  let prepared = 0;
  await progress(`Preparing ${intakes.length} jobs`);
  await pooled(intakes, PIPELINE_CONCURRENCY, async (intake) => {
    try {
      await runTaskNow(
        { kind: TaskKind.INTAKE_PIPELINE, label: `LinkedIn Sweep: ${intake.title}`.slice(0, 200), subjectId: intake.id, href: `/intakes/${intake.id}/review`, silent: true },
        (task) => runIntakePipeline(intake.id, task),
      );
    } catch { /* recorded on the task; the report shows it as needing the user */ }
    prepared += 1;
    await progress(`Prepared ${prepared} of ${intakes.length} jobs`);
  });
}

async function failStaleSweeps(now = new Date()) {
  await getPrisma().sweep.updateMany({
    where: { status: SweepStatus.RUNNING, updatedAt: { lt: new Date(now.getTime() - STALE_SWEEP_MS) } },
    data: { status: SweepStatus.FAILED, progress: null, error: "The server stopped before this sweep finished. Paste the page again; posts already handled are skipped." },
  });
}

const postSelection = {
  id: true, author: true, profileUrl: true, postUrl: true, headline: true, text: true, title: true, email: true, outcome: true, reason: true, intakeId: true,
  intake: {
    select: {
      status: true, preview: true, opportunityId: true,
      opportunity: {
        select: {
          matchScore: true,
          outreachDraft: { select: { autoSendState: true, autoSentAt: true, outlookState: true, autoSendError: true, outlookError: true } },
        },
      },
    },
  },
} as const;

/** The recent sweeps, each with every post it judged and where the queued ones stand now. */
export async function recentSweeps(limit = 7) {
  await failStaleSweeps();
  const database = getPrisma();
  const sweeps = await database.sweep.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { posts: { select: postSelection, orderBy: { createdAt: "asc" } } },
  });
  const intakeIds = sweeps.flatMap((sweep) => sweep.posts.flatMap((post) => (post.intakeId ? [post.intakeId] : [])));
  const taskHistory = await database.task.findMany({
    where: { subjectId: { in: intakeIds }, kind: TaskKind.INTAKE_PIPELINE },
    select: { subjectId: true, status: true, error: true, startedAt: true },
    orderBy: { startedAt: "desc" },
  });
  const latestTasks = new Map<string, { status: TaskStatus; error: string | null }>();
  for (const task of taskHistory) if (task.subjectId && !latestTasks.has(task.subjectId)) latestTasks.set(task.subjectId, task);

  return sweeps.map((sweep) => ({
    id: sweep.id,
    status: sweep.status,
    progress: sweep.progress,
    error: sweep.error,
    postCount: sweep.postCount,
    repeats: sweep.repeats,
    createdAt: sweep.createdAt,
    posts: sweep.posts.map((post) => {
      const preview = post.intake ? parseIntakePreview(post.intake.preview) : null;
      const live = post.outcome === SweepOutcome.QUEUED
        ? sweepItemState(post.intake ? {
            status: post.intake.status,
            hasPreview: Boolean(preview),
            stopReason: preview?.brake ?? preview?.hold ?? null,
            draft: post.intake.opportunity?.outreachDraft ?? null,
        } : null, Boolean(post.intakeId && latestTasks.get(post.intakeId)?.status === TaskStatus.FAILED), post.intakeId ? latestTasks.get(post.intakeId)?.error ?? null : null)
        : null;
      return {
        id: post.id,
        author: post.author,
        profileUrl: post.profileUrl,
        postUrl: post.postUrl,
        explicitC2C: /\b(?:c2c|c2h|corp[-\s]?to[-\s]?corp)\b/i.test(post.text) && !/\b(?:no|not|without)\s+(?:c2c|c2h|corp[-\s]?to[-\s]?corp)\b/i.test(post.text),
        headline: post.headline,
        excerpt: post.text.slice(0, 600),
        title: post.title,
        email: post.email,
        outcome: post.outcome,
        reason: post.reason,
        intakeId: post.intakeId,
        opportunityId: post.intake?.opportunityId ?? null,
        matchScore: post.intake?.opportunity?.matchScore ?? preview?.match?.score ?? null,
        state: live?.state ?? null,
        detail: live?.detail ?? null,
      };
    }),
  }));
}

/** Retries the unfinished intake work already stored for a sweep; no LinkedIn paste is needed. */
export async function resweepSweep(sweepId: string, defer: (run: () => Promise<void>) => void, scope: "all" | "needs" = "all") {
  const database = getPrisma();
  const sweep = await database.sweep.findUnique({
    where: { id: sweepId },
    select: { id: true, posts: { where: { outcome: SweepOutcome.QUEUED, intakeId: { not: null } }, select: { intakeId: true } } },
  });
  if (!sweep) throw new SweepInputError("Sweep not found.");
  const intakeIds = sweep.posts.flatMap((post) => post.intakeId ? [post.intakeId] : []);
  if (!intakeIds.length) return 0;
  const [intakes, tasks] = await Promise.all([
    database.jobIntake.findMany({ where: { id: { in: intakeIds }, status: IntakeStatus.PENDING }, select: { id: true, preview: true } }),
    database.task.findMany({ where: { subjectId: { in: intakeIds }, kind: TaskKind.INTAKE_PIPELINE }, select: { subjectId: true, status: true, startedAt: true }, orderBy: { startedAt: "desc" } }),
  ]);
  const latest = new Map<string, TaskStatus>();
  for (const task of tasks) if (task.subjectId && !latest.has(task.subjectId)) latest.set(task.subjectId, task.status);
  const retryIds = intakes.filter((intake) => {
    const preview = parseIntakePreview(intake.preview);
    const needs = latest.get(intake.id) === TaskStatus.FAILED || !preview || Boolean(preview.brake || preview.hold);
    return scope === "all" || needs;
  }).map((intake) => intake.id);
  if (!retryIds.length) return 0;

  // Re-screen from the saved raw JD so a resweep picks up changed application rules and resume routing.
  await database.jobIntake.updateMany({
    where: { id: { in: retryIds }, status: IntakeStatus.PENDING },
    data: { analysis: Prisma.JsonNull, policy: Prisma.JsonNull, preview: Prisma.JsonNull },
  });
  await database.sweep.update({ where: { id: sweepId }, data: { status: SweepStatus.RUNNING, progress: `Resweeping ${retryIds.length} jobs`, error: null } });
  defer(async () => {
    try {
      let done = 0;
      await pooled(retryIds, PIPELINE_CONCURRENCY, async (intakeId) => {
        try {
          await runTaskNow(
            { kind: TaskKind.INTAKE_PIPELINE, label: `Resweep: ${intakeId}`.slice(0, 200), subjectId: intakeId, href: `/intakes/${intakeId}/review`, silent: true },
            (task) => runIntakePipeline(intakeId, task),
          );
        } catch { /* the latest task remains failed and the row stays visible */ }
        done += 1;
        await database.sweep.update({ where: { id: sweepId }, data: { progress: `Reswept ${done} of ${retryIds.length} jobs` } });
      });
      await database.sweep.update({ where: { id: sweepId }, data: { status: SweepStatus.DONE, progress: null } });
    } catch (error) {
      await database.sweep.update({ where: { id: sweepId }, data: { status: SweepStatus.FAILED, progress: null, error: (error instanceof Error ? error.message : "The resweep failed.").slice(0, 500) } }).catch(() => {});
    }
  });
  return retryIds.length;
}

/** Restores one skipped post whose location was not stated, then runs the normal autopilot pipeline. */
export async function restoreSweepPost(postId: string) {
  const database = getPrisma();
  const post = await database.sweepPost.findUnique({ where: { id: postId } });
  if (!post) throw new SweepInputError("Sweep post not found.");
  if (post.outcome !== SweepOutcome.SKIPPED) throw new SweepInputError("Only skipped sweep posts can be restored.");
  if (post.intakeId) {
    await database.jobIntake.update({ where: { id: post.intakeId }, data: { status: IntakeStatus.PENDING } });
    await database.sweepPost.update({ where: { id: postId }, data: { outcome: SweepOutcome.QUEUED, reason: "Restored: YOE is not used as an application filter." } });
    await runTaskNow(
      { kind: TaskKind.INTAKE_PIPELINE, label: `LinkedIn Restore: ${post.title ?? post.author}`.slice(0, 200), subjectId: post.intakeId, href: `/intakes/${post.intakeId}/review`, silent: true },
      (task) => runIntakePipeline(post.intakeId!, task),
    );
    return post.intakeId;
  }
  const rawText = postIntakeText({ author: post.author, profileUrl: post.profileUrl, postUrl: post.postUrl, headline: post.headline, age: null, body: post.text });
  const intake = await database.jobIntake.create({
    data: { sourceType: JobSourceType.LINKEDIN_POST, rawText, originalSender: null, receivedAt: new Date(), fingerprint: jobFingerprint(rawText) },
    select: { id: true },
  });
  await database.sweepPost.update({ where: { id: postId }, data: { outcome: SweepOutcome.QUEUED, reason: "Restored: location not stated; allowed into autopilot.", intakeId: intake.id } });
  await runTaskNow(
    { kind: TaskKind.INTAKE_PIPELINE, label: `LinkedIn Restore: ${post.title ?? post.author}`.slice(0, 200), subjectId: intake.id, href: `/intakes/${intake.id}/review`, silent: true },
    (task) => runIntakePipeline(intake.id, task),
  );
  return intake.id;
}

export type SweepView = Awaited<ReturnType<typeof recentSweeps>>[number];

/** Jobs from any source the autopilot passed on under the rules this week, for a second look. */
export async function skippedByRules(days = 7) {
  const intakes = await getPrisma().jobIntake.findMany({
    where: { status: IntakeStatus.SKIPPED, updatedAt: { gte: new Date(Date.now() - days * 86_400_000) } },
    select: { id: true, sourceType: true, analysis: true, preview: true, rawText: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  return intakes.map((intake) => {
    const analysis = intake.analysis as { title?: string | null; recruiterName?: string | null } | null;
    return {
      id: intake.id,
      sourceType: intake.sourceType,
      title: analysis?.title?.slice(0, 120) || intake.rawText.trim().split("\n")[0]?.slice(0, 120) || "Untitled source",
      recruiter: analysis?.recruiterName ?? null,
      reason: parseIntakePreview(intake.preview)?.brake ?? null,
      at: intake.updatedAt,
    };
  });
}

/** The user overrides a skip: the job returns to the queue as it was, to review and confirm by hand. */
export async function reviewSkipped(intakeId: string) {
  const { count } = await getPrisma().jobIntake.updateMany({ where: { id: intakeId, status: IntakeStatus.SKIPPED }, data: { status: IntakeStatus.PENDING } });
  return count === 1;
}
