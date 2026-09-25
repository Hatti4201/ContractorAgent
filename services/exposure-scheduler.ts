import { exposureState, loadExposureConfig, runExposure } from "@/services/exposure-run";
import { shouldScanNow } from "@/services/mail-schedule";

// Same pattern as the mail scheduler: a short tick, and the decision made from the last run time.
// Settings are re-read every tick, so a change saved on /exposure takes effect without a restart.
const TICK_MS = 5 * 60_000;

const globalForScheduler = globalThis as unknown as { exposureTimer?: ReturnType<typeof setInterval> };

async function tick() {
  const config = await loadExposureConfig();
  const state = await exposureState();
  if (!shouldScanNow(new Date(), state.lastRunAt, config.window)) return;
  await runExposure();
}

/** Always registers, because the mode can be switched on from the page; an "off" tick does nothing. */
export function startExposureScheduler() {
  if (globalForScheduler.exposureTimer) return;
  const timer = setInterval(() => { void tick().catch(() => {}); }, TICK_MS);
  timer.unref();
  globalForScheduler.exposureTimer = timer;
  void tick().catch(() => {});
  console.log("Dice exposure scheduler started; mode and schedule are set on /exposure.");
}
