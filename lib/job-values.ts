import {
  ActivityType,
  ApplicationStage,
  EmploymentType,
  JobSourceType,
  RoleFamily,
  WorkArrangement,
} from "@/app/generated/prisma/enums";

export const activityTypes = Object.values(ActivityType);
export const applicationStages = Object.values(ApplicationStage);
export const employmentTypes = Object.values(EmploymentType);
export const jobSourceTypes = Object.values(JobSourceType);
export const roleFamilies = Object.values(RoleFamily);
export const workArrangements = Object.values(WorkArrangement);

export const intakeStates: Record<string, { label: string; tone: string }> = {
  ANALYZING: { label: "Preparing", tone: "bg-slate-100 text-slate-700" },
  READY: { label: "Ready to review", tone: "bg-emerald-50 text-emerald-800" },
  STOPPED: { label: "Needs your input", tone: "bg-amber-50 text-amber-900" },
  FAILED: { label: "Interrupted", tone: "bg-red-50 text-red-800" },
};

export function formatEnum(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatDate(value: Date | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(value);
}

export function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(value);
}

export function dateInputValue(value: Date | null) {
  return value?.toISOString().slice(0, 10) ?? "";
}

/**
 * A date input submits exactly what it renders, so this stays strict and rejects an impossible day.
 */
export function dateValue(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid date.");
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("Invalid date.");
  return date;
}

/**
 * A datetime-local input renders minutes but submits seconds, and sometimes milliseconds, as soon as
 * the field is touched. Accept those, and still reject an hour or a month that cannot exist.
 */
export function dateTimeValue(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value) return new Date();
  const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,3})?$/.exec(value);
  if (!parts) throw new Error("Invalid date and time.");
  const [, day, hour, minute, second = "00"] = parts;
  const date = new Date(`${day}T${hour}:${minute}:${second}.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 19) !== `${day}T${hour}:${minute}:${second}`) {
    throw new Error("Invalid date and time.");
  }
  return date;
}
