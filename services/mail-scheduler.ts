import { TaskKind } from "@/app/generated/prisma/enums";
import { mailScanState, scanFollowUps } from "@/services/follow-up-scan";
import { scanWindowFromEnv, shouldScanNow } from "@/services/mail-schedule";
import { outlookConnected } from "@/services/outlook-auth";
import { runTaskNow, TaskBusyError } from "@/services/tasks";

// The tick is short and the decision is made from the last run time, so a missed or delayed tick
// self-corrects rather than drifting or firing a burst of catch-up scans.
const TICK_MS = 5 * 60_000;

// ponytail: the timer lives in this Node process, which is the ceiling for a local single-user app.
// Stopping the server stops the schedule; the stale sweep reports whatever it interrupted.
const globalForScheduler = globalThis as unknown as { mailScanTimer?: ReturnType<typeof setInterval> };

async function tick() {
  const window = scanWindowFromEnv();
  if (!window.enabled) return;
  const state = await mailScanState();
  if (!shouldScanNow(new Date(), state.lastRunAt, window)) return;
  // Without a connected mailbox there is nothing to scan, and recording a failure would be noise.
  if (!await outlookConnected()) return;

  try {
    await runTaskNow(
      { kind: TaskKind.FOLLOW_UP_SCAN, label: "Scheduled Outlook scan", subjectId: "follow-up-scan", href: "/needs-attention" },
      (task) => scanFollowUps(task).then(() => undefined),
    );
  } catch (error) {
    // A manual scan already running is the expected collision, not a problem worth reporting.
    if (!(error instanceof TaskBusyError)) throw error;
  }
}

export function startMailScanScheduler() {
  if (globalForScheduler.mailScanTimer) return;
  const window = scanWindowFromEnv();
  if (!window.enabled) return;

  const timer = setInterval(() => { void tick().catch(() => {}); }, TICK_MS);
  timer.unref();
  globalForScheduler.mailScanTimer = timer;
  void tick().catch(() => {});
  console.log(`Outlook scan scheduled: days ${window.days.join(",")}, ${window.startHour}:00-${window.endHour}:00 ${window.timeZone}, every ${window.intervalMs / 60_000} minutes.`);
}
