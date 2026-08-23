import { configuredTimeZone } from "@/services/attention";

export type ScanWindow = {
  enabled: boolean;
  days: number[];
  startHour: number;
  endHour: number;
  intervalMs: number;
  timeZone: string;
};

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function number(value: string | undefined, fallback: number, low: number, high: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= low && parsed <= high ? parsed : fallback;
}

export function scanWindowFromEnv(env: Partial<Record<string, string>> = process.env): ScanWindow {
  const days = (env.MAIL_SCAN_DAYS ?? "1,2,3,4,5")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
  return {
    enabled: (env.MAIL_SCAN_ENABLED ?? "true").toLowerCase() !== "false",
    days: days.length ? [...new Set(days)] : [1, 2, 3, 4, 5],
    startHour: number(env.MAIL_SCAN_START_HOUR, 6, 0, 23),
    endHour: number(env.MAIL_SCAN_END_HOUR, 15, 0, 23),
    intervalMs: number(env.MAIL_SCAN_INTERVAL_MINUTES, 60, 5, 1440) * 60_000,
    timeZone: configuredTimeZone(env.APP_TIME_ZONE),
  };
}

/** Reads the weekday and hour as they read on a wall clock in the configured zone. */
export function localClock(now: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return { day: weekdays.indexOf(parts.weekday ?? ""), hour: Number(parts.hour) };
}

export function isWithinScanWindow(now: Date, window: ScanWindow) {
  const { day, hour } = localClock(now, window.timeZone);
  return window.days.includes(day) && hour >= window.startHour && hour < window.endHour;
}

/**
 * Compares against the last run rather than counting ticks, so a suspended laptop or a restarted
 * server resumes on the next tick instead of drifting or firing a burst of catch-up scans.
 */
export function shouldScanNow(now: Date, lastRunAt: Date | null, window: ScanWindow) {
  if (!window.enabled || !isWithinScanWindow(now, window)) return false;
  return !lastRunAt || now.getTime() - lastRunAt.getTime() >= window.intervalMs;
}
