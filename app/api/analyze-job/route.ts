import { JobSourceType } from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";
import { isAuthenticated } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
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
    const sourceType = typeof input.sourceType === "string" && Object.values(JobSourceType).includes(input.sourceType as JobSourceType)
      ? input.sourceType as JobSourceType
      : null;
    if (!sourceType) throw new IntakeInputError("Invalid source type.");
    const rawText = text(input.rawText, 50_000, true)!;
    const originalSender = text(input.originalSender, 500);
    const attachments = Array.isArray(input.attachments)
      ? input.attachments.map((item) => text(item, 255, true)!).slice(0, 20)
      : [];
    if (Array.isArray(input.attachments) && input.attachments.length > 20) throw new IntakeInputError("Too many attachments.");
    const receivedAt = input.receivedAt ? new Date(String(input.receivedAt)) : new Date();
    if (Number.isNaN(receivedAt.getTime())) throw new IntakeInputError("Invalid received date.");

    const analysis = await analyzeJobText({ sourceType, rawText, originalSender });
    const intake = await getPrisma().jobIntake.create({
      data: {
        sourceType,
        rawText,
        originalSender,
        receivedAt,
        ...(attachments.length ? { attachmentMetadata: attachments } : {}),
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
