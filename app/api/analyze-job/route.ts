import { after } from "next/server";
import { TaskKind } from "@/app/generated/prisma/enums";
import { isAuthenticated } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { detectIntakeSource } from "@/services/intake-source";
import { runIntakePipeline } from "@/services/intake-pipeline";
import { jobFingerprint } from "@/services/job-case";
import { startTask } from "@/services/tasks";

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

  // The source facts are derived here, never supplied by the caller, and stay correctable on review.
  const { sourceType, originalSender, receivedAt } = detectIntakeSource(rawText);
  const intake = await getPrisma().jobIntake.create({
    data: { sourceType, rawText, originalSender, receivedAt, fingerprint: jobFingerprint(rawText) },
    select: { id: true },
  });

  // Analysis, resume routing, drafting and validation all run after this response, so pasting never waits.
  await startTask(
    { kind: TaskKind.INTAKE_PIPELINE, label: "Preparing a job from your pasted text", subjectId: intake.id, href: `/intakes/${intake.id}/review` },
    (task) => runIntakePipeline(intake.id, task),
    after,
  );

  return Response.json(
    { reviewUrl: `/intakes/${intake.id}/review` },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
}
