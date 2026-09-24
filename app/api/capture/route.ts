import { after } from "next/server";
import { isAuthenticated, isBookmarkletKeyValid } from "@/lib/auth";
import { capturedText } from "@/lib/capture";
import { getPrisma } from "@/lib/prisma";
import { jobFingerprint } from "@/services/job-case";
import { startPastedIntake } from "@/services/pasted-intake";

/**
 * What the LinkedIn bookmarklet submits through /capture. It needs the session like any paste, and
 * the bookmarklet's key as well: /capture submits without a click, so the key is what tells a post
 * the user selected apart from a page some other site opened with text of its own.
 */
export async function POST(request: Request) {
  if (!await isAuthenticated()) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > 100_000) return Response.json({ error: "The selection is too large." }, { status: 413 });

  let input: Record<string, unknown>;
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    input = value as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Nothing was captured." }, { status: 400 });
  }
  if (!isBookmarkletKeyValid(input.key)) {
    return Response.json({ error: "This bookmarklet is not recognised. Install it again from Add job." }, { status: 403 });
  }
  const selection = typeof input.text === "string" ? input.text.trim() : "";
  if (!selection) return Response.json({ error: "Nothing was selected." }, { status: 400 });

  const rawText = capturedText(selection, input.url);
  // A second click on the same post is not a second job; two pipelines racing would both pass the
  // duplicate check, which only sees jobs that already exist.
  const recent = await getPrisma().jobIntake.count({
    where: { fingerprint: jobFingerprint(rawText), createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) } },
  });
  if (recent) return Response.json({ error: "This post was already sent to the agent today." }, { status: 409 });

  await startPastedIntake(rawText, "Preparing a job from a LinkedIn post", after);
  return Response.json({ ok: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
