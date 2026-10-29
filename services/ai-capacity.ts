import { ExposureResult } from "@/app/generated/prisma/enums";

const AI_CAPACITY_PATTERN = /\[OPENAI_API_(?:QUOTA_EXHAUSTED|RATE_LIMITED|429)\]|(?:openai|api|model)[^\n]{0,120}(?:quota|rate limit|too many requests)|(?:quota|rate limit|too many requests)[^\n]{0,120}(?:openai|api|model)|\bHTTP\s*429\b/i;

/** True only for a provider capacity error, not a malformed response or a bad prompt. */
export function isAiCapacityError(value: unknown) {
  const text = value instanceof Error ? value.message : typeof value === "string" ? value : "";
  return AI_CAPACITY_PATTERN.test(text);
}

export function aiCapacityLabel(value: unknown) {
  const text = value instanceof Error ? value.message : typeof value === "string" ? value : "";
  return /QUOTA_EXHAUSTED|quota|credits? exhausted|billing/i.test(text) ? "AI 额度已用尽" : "AI 限流";
}

/** Keep only the latest Dice result per job, so a later success clears its old AI alert. */
export function unresolvedAiCapacityApplications<T extends { externalId: string; result: ExposureResult; reason: string | null }>(rows: readonly T[]) {
  const latest = new Map<string, T>();
  for (const row of rows) if (!latest.has(row.externalId)) latest.set(row.externalId, row);
  return [...latest.values()].filter((row) => row.result === ExposureResult.FAILED && isAiCapacityError(row.reason));
}
