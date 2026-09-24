import { after } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { startPastedIntake } from "@/services/pasted-intake";

export async function POST(request: Request) {
  if (!await isAuthenticated()) return Response.json({ error: "Unauthorized." }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > 100_000) return Response.json({ error: "Request is too large." }, { status: 413 });

  let rawText: string;
  try {
    const value: unknown = await request.json();
    const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
    rawText = typeof input?.rawText === "string" ? input.rawText.trim() : "";
    if (!rawText || rawText.length > 50_000) throw new Error();
  } catch {
    return Response.json({ error: "Paste the job description text." }, { status: 400 });
  }

  const intakeId = await startPastedIntake(rawText, "Preparing a job from your pasted text", after);

  return Response.json(
    { reviewUrl: `/intakes/${intakeId}/review` },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
}
