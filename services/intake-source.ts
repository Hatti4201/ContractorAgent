import { JobSourceType } from "@/app/generated/prisma/enums";

const MAX_SENDER_LENGTH = 500;
const forwardMarkers = [
  /^[ \t>]*-{2,}[ \t]*forwarded message[ \t]*-{2,}/im,
  /^[ \t>]*-{2,}[ \t]*original message[ \t]*-{2,}/im,
  /^[ \t>]*(?:subject|betreff|主题)[ \t]*[:：][ \t]*(?:fwd?|fw|转发)[ \t]*[:：]/im,
  /^[ \t>]*(?:fwd|fw|转发)[ \t]*[:：]/im,
];
const fromLine = /^[ \t>]*from[ \t]*[:：][ \t]*(.+)$/im;
const dateLine = /^[ \t>]*(?:sent|date)[ \t]*[:：][ \t]*(.+)$/im;
const toLine = /^[ \t>]*to[ \t]*[:：][ \t]*(.+)$/im;

function sentDate(rawText: string, now: Date) {
  const captured = dateLine.exec(rawText)?.[1]?.trim();
  if (!captured || captured.length > 100) return now;
  const parsed = new Date(captured);
  // A header date only wins when it is plausible; anything else falls back to the paste time.
  if (Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() < 2000) return now;
  return parsed.getTime() > now.getTime() + 86_400_000 ? now : parsed;
}

export function detectIntakeSource(rawText: string, now = new Date()) {
  const forwarded = forwardMarkers.some((marker) => marker.test(rawText));
  const sender = fromLine.exec(rawText)?.[1]?.trim().slice(0, MAX_SENDER_LENGTH) || null;
  const sourceType = forwarded
    ? JobSourceType.FORWARDED_JD
    : sender && (toLine.test(rawText) || dateLine.test(rawText))
      ? JobSourceType.DIRECT_EMAIL
      : /linkedin\.com/i.test(rawText)
        ? JobSourceType.LINKEDIN_POST
        : JobSourceType.PLAIN_TEXT;

  return {
    sourceType,
    // ponytail: the first From: is the outermost envelope, so a forwarded paste reports the forwarder.
    // Starting the paste below the forward marker names the recruiter instead, which makes the outreach
    // validator refuse the recipient rather than silently allow it. Correct it on the review screen.
    originalSender: sender,
    receivedAt: sentDate(rawText, now),
  };
}
