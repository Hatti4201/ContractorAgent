import { createHmac, timingSafeEqual } from "node:crypto";
import { MAX_CAPTURE_LENGTH } from "@/lib/bookmarklet";

/**
 * The secret the bookmarklet carries. /capture submits on its own, so without this any website could
 * open it with a made-up JD naming its own address, and with AUTOPILOT=send the resume would be mailed
 * there. Derived from SESSION_SECRET, so rotating that secret retires every installed bookmarklet.
 */
export function captureKey(secret: string) {
  return createHmac("sha256", secret).update("linkedin-capture-v1").digest("base64url").slice(0, 32);
}

export function captureKeyMatches(candidate: unknown, secret: string) {
  if (typeof candidate !== "string") return false;
  // Compared as bytes: a same-length string with non-ASCII characters has a longer buffer, and
  // timingSafeEqual throws on buffers of different lengths.
  const supplied = Buffer.from(candidate);
  const expected = Buffer.from(captureKey(secret));
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

/** The pasted text the pipeline sees: the selection, then where it came from, which also marks it as LinkedIn. */
export function capturedText(selection: string, pageUrl: unknown) {
  const text = selection.trim().slice(0, MAX_CAPTURE_LENGTH);
  let source = "";
  if (typeof pageUrl === "string" && pageUrl.length <= 2000) {
    try {
      const url = new URL(pageUrl);
      if (url.protocol === "https:") source = `\n\nSource: ${url.toString()}`;
    } catch { /* no usable source; the text stands alone */ }
  }
  return `${text}${source}`;
}
