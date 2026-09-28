/** The one-line notice after a job is deleted, from the ?deleted= its action left behind. */
export function deletedNotice(value: unknown): { text: string; tone: "ok" | "warn" } | null {
  if (value === "deleted") return { text: "Deleted · Outlook draft removed", tone: "ok" };
  if (value === "none") return { text: "Deleted", tone: "ok" };
  if (value === "kept") return { text: "Deleted · Outlook draft kept (Outlook unreachable)", tone: "warn" };
  return null;
}
