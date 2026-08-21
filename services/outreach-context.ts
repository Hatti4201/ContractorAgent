import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolvePrivateFile } from "@/services/private-file";

const MAX_CONTEXT_BYTES = 100_000;

export function outreachContextFingerprint(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

export async function loadOutreachContext(options: { filePath?: string; text?: string } = {}) {
  if (options.text !== undefined) {
    const content = options.text.trim();
    if (!content || Buffer.byteLength(content) > MAX_CONTEXT_BYTES || content.includes("\0")) throw new Error("Private outreach context is invalid.");
    return content;
  }

  const file = await resolvePrivateFile(options.filePath ?? process.env.OUTREACH_CONTEXT_PATH ?? "");
  if (!file.usable || !file.canonicalPath || !file.size || file.size > MAX_CONTEXT_BYTES) {
    throw new Error(file.issue ?? "Private outreach context is invalid.");
  }
  const content = (await readFile(file.canonicalPath, "utf8")).trim();
  if (!content || content.includes("\0")) throw new Error("Private outreach context is invalid.");
  return content;
}
