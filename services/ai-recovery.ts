import { ExposureChannel, FollowUpStatus, IntakeStatus, SweepOutcome, TaskKind, TaskStatus } from "@/app/generated/prisma/enums";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import { isAiCapacityError, aiCapacityLabel, unresolvedAiCapacityApplications } from "@/services/ai-capacity";
import { runIntakePipeline } from "@/services/intake-pipeline";
import { syncOutlookConversations } from "@/services/conversation-sync";
import { scanFollowUps } from "@/services/follow-up-scan";
import { runTaskNow, TaskBusyError, type TaskHandle } from "@/services/tasks";
import { runOutreachDraftGeneration, runOutreachDraftValidation } from "@/app/(protected)/jobs/[id]/outreach/actions";
import { currentAutopilotMode } from "@/services/auto-send";
import { autopilotApplies } from "@/services/autopilot";
import { waitingForAutopilot } from "@/services/autopilot-batch";
import { resumeAutopilot } from "@/services/intake-pipeline";

const RECOVERY_INTERVAL_MS = 15 * 60_000;
const MAX_ALERTS = 100;
const globalForRecovery = globalThis as unknown as { aiRecoveryAt?: number };

export type AiCapacityAlert = {
  id: string;
  label: string;
  detail: string;
  at: Date;
  href: string;
};

function taskLabel(kind: TaskKind) {
  const labels: Partial<Record<TaskKind, string>> = {
    [TaskKind.INTAKE_PIPELINE]: "岗位分析/准备",
    [TaskKind.OUTREACH_REGENERATE]: "Outreach 草稿",
    [TaskKind.OUTREACH_VALIDATE]: "Outreach 校验",
    [TaskKind.FOLLOW_UP_SCAN]: "Outlook 邮件分析",
    [TaskKind.FOLLOW_UP_RETRY]: "Recruiter 邮件重试",
    [TaskKind.AUTOPILOT_BATCH]: "Autopilot 岗位处理",
  };
  return labels[kind] ?? "AI 任务";
}

async function latestFailedTasks(database: PrismaClient) {
  const rows = await database.task.findMany({
    select: { id: true, kind: true, subjectId: true, href: true, error: true, status: true, finishedAt: true, startedAt: true },
    orderBy: { startedAt: "desc" },
    take: MAX_ALERTS * 10,
  });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.kind}:${row.subjectId ?? row.id}`;
    if (!latest.has(key)) latest.set(key, row);
  }
  return [...latest.values()].filter((row) => row.status === TaskStatus.FAILED && isAiCapacityError(row.error));
}

/** All currently visible AI capacity failures, collapsed to the latest task per work item. */
export async function aiCapacityAlerts(database = getPrisma()): Promise<AiCapacityAlert[]> {
  const [tasks, scan, exposure, suggestions, sweepPosts, sweeps, applications] = await Promise.all([
    latestFailedTasks(database),
    database.mailScanState.findUnique({ where: { id: "primary" }, select: { lastError: true, lastErrorAt: true, errorClearedAt: true, updatedAt: true } }),
    database.exposureState.findUnique({ where: { id: "primary" }, select: { lastError: true, lastErrorAt: true, errorClearedAt: true, updatedAt: true } }),
    database.followUpSuggestion.findMany({ where: { status: FollowUpStatus.FAILED, error: { not: null } }, select: { id: true, subject: true, error: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: MAX_ALERTS }),
    database.sweepPost.findMany({ where: { outcome: SweepOutcome.FAILED, reason: { not: null } }, select: { id: true, title: true, reason: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: MAX_ALERTS }),
    database.sweep.findMany({ where: { error: { not: null } }, select: { id: true, error: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: MAX_ALERTS }),
    database.exposureApplication.findMany({ where: { channel: ExposureChannel.DICE }, select: { id: true, externalId: true, result: true, title: true, reason: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: MAX_ALERTS * 10 }),
  ]);
  const alerts: AiCapacityAlert[] = tasks.map((row) => ({
    id: `task:${row.id}`,
    label: taskLabel(row.kind),
    detail: row.error ?? "AI 额度/限流错误",
    at: row.finishedAt ?? row.startedAt,
    href: row.href ?? "/dashboard",
  }));
  const addState = (source: string, state: typeof scan, label: string, href: string) => {
    if (!state?.lastError || !isAiCapacityError(state.lastError)) return;
    const at = state.lastErrorAt ?? state.updatedAt;
    if (state.errorClearedAt && at <= state.errorClearedAt) return;
    alerts.push({ id: `${source}:${at.toISOString()}`, label, detail: state.lastError, at, href });
  };
  addState("mail", scan, "Outlook 邮件分析", "/needs-attention");
  addState("dice", exposure, "Dice AI 操作", "/exposure");
  for (const row of suggestions.filter((item) => isAiCapacityError(item.error))) alerts.push({ id: `suggestion:${row.id}`, label: "Recruiter 邮件分析", detail: row.error!, at: row.createdAt, href: "/needs-attention" });
  for (const row of sweepPosts.filter((item) => isAiCapacityError(item.reason))) alerts.push({ id: `sweep-post:${row.id}`, label: "LinkedIn Sweep", detail: row.reason!, at: row.createdAt, href: "/sweep" });
  for (const row of sweeps.filter((item) => isAiCapacityError(item.error))) alerts.push({ id: `sweep:${row.id}`, label: "LinkedIn Sweep", detail: row.error!, at: row.updatedAt, href: "/sweep" });
  for (const row of unresolvedAiCapacityApplications(applications)) alerts.push({ id: `dice-application:${row.id}`, label: "Dice application", detail: row.reason!, at: row.createdAt, href: "/exposure" });
  return alerts.sort((left, right) => right.at.getTime() - left.at.getTime()).slice(0, MAX_ALERTS);
}

async function retryTask(database: PrismaClient, request: Parameters<typeof runTaskNow>[0], work: Parameters<typeof runTaskNow>[1]) {
  try {
    const id = await runTaskNow(request, work);
    const result = await database.task.findUnique({ where: { id }, select: { status: true, error: true } });
    return !(result?.status === TaskStatus.FAILED && isAiCapacityError(result.error));
  } catch (error) {
    if (error instanceof TaskBusyError) return true;
    if (isAiCapacityError(error)) return false;
    return true;
  }
}

async function retryPendingIntakes(database: PrismaClient) {
  const tasks = await latestFailedTasks(database);
  for (const task of tasks.filter((row) => row.kind === TaskKind.INTAKE_PIPELINE && row.subjectId)) {
    const intake = await database.jobIntake.findUnique({ where: { id: task.subjectId! }, select: { id: true, status: true, opportunityId: true } });
    if (!intake || intake.status !== IntakeStatus.PENDING || intake.opportunityId) continue;
    const available = await retryTask(database, { kind: TaskKind.INTAKE_PIPELINE, label: "Retrying an AI-blocked job", subjectId: intake.id, href: task.href ?? `/intakes/${intake.id}/review`, silent: true }, (handle) => runIntakePipeline(intake.id, handle));
    if (!available) return false;
  }
  return true;
}

async function retryMailAnalysis(database: PrismaClient) {
  const tasks = await latestFailedTasks(database);
  for (const task of tasks.filter((row) => row.kind === TaskKind.FOLLOW_UP_SCAN)) {
    const available = await retryTask(database, { kind: TaskKind.FOLLOW_UP_SCAN, label: "Retrying AI-blocked Outlook analysis", subjectId: task.subjectId ?? "follow-up-scan", href: task.href ?? "/needs-attention" }, async (handle) => {
      await syncOutlookConversations(handle, true);
      await scanFollowUps(handle);
    });
    if (!available) return false;
  }
  return true;
}

async function retryOutreachAndAutopilot(database: PrismaClient) {
  const tasks = await latestFailedTasks(database);
  for (const task of tasks.filter((row) => row.subjectId && (row.kind === TaskKind.OUTREACH_REGENERATE || row.kind === TaskKind.OUTREACH_VALIDATE))) {
    const job = await database.opportunity.findUnique({ where: { id: task.subjectId! }, select: { id: true, outreachDraft: { select: { outlookMessageId: true, outlookState: true } } } });
    if (!job || job.outreachDraft?.outlookMessageId || job.outreachDraft?.outlookState === "CREATED" || job.outreachDraft?.outlookState === "SENT") continue;
    const work = task.kind === TaskKind.OUTREACH_REGENERATE
      ? (handle: TaskHandle) => runOutreachDraftGeneration(job.id, handle)
      : async () => runOutreachDraftValidation(job.id);
    const available = await retryTask(database, { kind: task.kind, label: "Retrying an AI-blocked outreach task", subjectId: job.id, href: task.href ?? `/jobs/${job.id}/outreach` }, work);
    if (!available) return false;
  }

  if (!autopilotApplies(await currentAutopilotMode())) return true;
  const ids = await waitingForAutopilot();
  if (!ids.length) return true;
  const available = await retryTask(database, { kind: TaskKind.AUTOPILOT_BATCH, label: "Retrying AI-blocked Autopilot jobs", subjectId: "autopilot-batch", href: "/autopilot" }, async (handle) => {
    let done = 0;
    for (const id of ids) {
      await resumeAutopilot(id, handle);
      done += 1;
      await handle.progress(`${done} of ${ids.length} done`);
    }
  });
  return available;
}

/** Called by the existing local scheduler; it never retries a job that already has an opportunity. */
export async function recoverAiCapacityBlockedWork(now = Date.now()) {
  if (globalForRecovery.aiRecoveryAt && now - globalForRecovery.aiRecoveryAt < RECOVERY_INTERVAL_MS) return 0;
  globalForRecovery.aiRecoveryAt = now;
  const database = getPrisma();
  const alerts = await aiCapacityAlerts(database);
  if (!alerts.length) return 0;
  console.log(`AI capacity recovery: ${alerts.length} unresolved item(s); retrying safe work.`);
  const intakesReady = await retryPendingIntakes(database);
  if (!intakesReady) return 0;
  if (!await retryMailAnalysis(database)) return 0;
  await retryOutreachAndAutopilot(database);
  return alerts.length;
}

export { aiCapacityLabel };
