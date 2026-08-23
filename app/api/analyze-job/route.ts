import type { Prisma } from "@/app/generated/prisma/client";
import { isAuthenticated } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { detectIntakeSource } from "@/services/intake-source";
import { analyzeJobText } from "@/services/job-analyzer";
import { jobFingerprint } from "@/services/job-case";

class IntakeInputError extends Error {}

function text(value: unknown, maximum: number, required = false) {
  const cleaned = typeof value === "string" ? value.trim() : "";
  if (required && !cleaned) throw new IntakeInputError("Required text is missing.");
  if (cleaned.length > maximum) throw new IntakeInputError("Text is too long.");
  return cleaned || null;
}

export async function POST(request: Request) {
  if (!await isAuthenticated()) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 100_000) return Response.json({ error: "Request is too large." }, { status: 413 });

  let input: Record<string, unknown>;
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    input = value as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const rawText = text(input.rawText, 50_000, true)!;
    // The source facts are derived here, never supplied by the caller, and stay correctable on review.
    const { sourceType, originalSender, receivedAt } = detectIntakeSource(rawText);

    const analysis = await analyzeJobText({ sourceType, rawText, originalSender });
    const intake = await getPrisma().jobIntake.create({
      data: {
        sourceType,
        rawText,
        originalSender,
        receivedAt,
        analysis: analysis as unknown as Prisma.InputJsonValue,
        fingerprint: jobFingerprint(rawText),
      },
      select: { id: true },
    });
    return Response.json(
      { reviewUrl: `/intakes/${intake.id}/review` },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof IntakeInputError) return Response.json({ error: error.message }, { status: 400 });
    const configurationMissing = error instanceof Error && error.message === "OPENAI_API_KEY is not configured.";
    return Response.json(
      { error: configurationMissing ? "AI analyzer is not configured." : "Analysis failed. Review the input and AI configuration, then try again." },
      { status: configurationMissing ? 503 : 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
