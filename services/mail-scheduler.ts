import { TaskKind } from "@/app/generated/prisma/enums";
import { autoSendTick } from "@/services/auto-send";
import { digestTick } from "@/services/digest-send";
import { mailScanState, scanFollowUps } from "@/services/follow-up-scan";
import { syncOutlookConversations } from "@/services/conversation-sync";
import { outlookConnected } from "@/services/outlook-auth";
import { runTaskNow, TaskBusyError } from "@/services/tasks";

// The tick is short and the decision is made from the last run time, so a missed or delayed tick
// self-corrects rather than drifting or firing a burst of catch-up scans.
const TICK_MS = 5_000;
const SCAN_TICK_MS = 5 * 60_000;

// ponytail: the timer lives in this Node process, which is the ceiling for a local single-user app.
// Stopping the server stops the schedule; the stale sweep reports whatever it interrupted.
const globalForScheduler = globalThis as unknown as { mailScanTimer?: ReturnType<typeof setInterval> };

async function tick() {
  // Sending checks its own hours (see auto-send), so it runs ahead of the scan window check.
  await autoSendTick().catch(() => {});
  await digestTick().catch(() => {});
  const state = await mailScanState();
  if (!state.autoScanEnabled) return;
  if (state.lastRunAt && new Date().getTime() - state.lastRunAt.getTime() < SCAN_TICK_MS) return;
  // Without a connected mailbox there is nothing to scan, and recording a failure would be noise.
  if (!await outlookConnected()) return;

  try {
    await runTaskNow(
      { kind: TaskKind.FOLLOW_UP_SCAN, label: "Scheduled Outlook scan", subjectId: "follow-up-scan", href: "/needs-attention" },
      async (task) => {
        await syncOutlookConversations(task);
        await scanFollowUps(task);
      },
    );
  } catch (error) {
    // A manual scan already running is the expected collision, not a problem worth reporting.
    if (!(error instanceof TaskBusyError)) throw error;
  }
}

export function startMailScanScheduler() {
  if (globalForScheduler.mailScanTimer) return;

  const timer = setInterval(() => { void tick().catch(() => {}); }, TICK_MS);
  timer.unref();
  globalForScheduler.mailScanTimer = timer;
  void tick().catch(() => {});
  console.log(`Mail scheduler started: auto-send every 5 seconds; Outlook conversation scan every 5 minutes when enabled.`);
}
