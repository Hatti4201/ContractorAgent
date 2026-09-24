import { exposureConfigFromEnv } from "@/services/exposure-rules";
import { exposureState, runExposure } from "@/services/exposure-run";
import { shouldScanNow } from "@/services/mail-schedule";

// Same pattern as the mail scheduler: a short tick, and the decision made from the last run time.
const TICK_MS = 5 * 60_000;

const globalForScheduler = globalThis as unknown as { exposureTimer?: ReturnType<typeof setInterval> };

async function tick() {
  const config = exposureConfigFromEnv();
  const state = await exposureState();
  if (!shouldScanNow(new Date(), state.lastRunAt, config.window)) return;
  await runExposure();
}

/** Registers nothing while EXPOSURE_MODE is off, which is the default (REQUIREMENTS FR-14). */
export function startExposureScheduler() {
  if (globalForScheduler.exposureTimer) return;
  const config = exposureConfigFromEnv();
  if (config.mode === "off") return;

  const timer = setInterval(() => { void tick().catch(() => {}); }, TICK_MS);
  timer.unref();
  globalForScheduler.exposureTimer = timer;
  void tick().catch(() => {});
  const { days, startHour, endHour, intervalMs, timeZone } = config.window;
  console.log(`Dice exposure (${config.mode}) scheduled: days ${days.join(",")}, ${startHour}:00-${endHour}:00 ${timeZone}, every ${intervalMs / 60_000} minutes.`);
}
