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
