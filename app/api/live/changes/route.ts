import { isAuthenticated } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

/** One cheap watermark for the database-backed pages; the client fetches full data only when it moves. */
export async function GET() {
  if (!await isAuthenticated()) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const database = getPrisma();
  const [intake, opportunity, track, draft, sweep, post, task, followUp] = await Promise.all([
    database.jobIntake.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    database.opportunity.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    database.applicationTrack.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    database.outreachDraft.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    database.sweep.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    database.sweepPost.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    database.task.findFirst({ orderBy: { finishedAt: "desc" }, select: { startedAt: true, finishedAt: true } }),
    database.followUpSuggestion.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
  ]);
  const dates = [intake?.updatedAt, opportunity?.updatedAt, track?.updatedAt, draft?.updatedAt, sweep?.updatedAt, post?.createdAt, task?.startedAt, task?.finishedAt, followUp?.updatedAt].filter((date): date is Date => Boolean(date));
  const changedAt = dates.length ? new Date(Math.max(...dates.map((date) => date.getTime()))).toISOString() : null;
  return Response.json({ changedAt }, { headers: { "Cache-Control": "no-store" } });
}
