import { TaskStatus } from "@/app/generated/prisma/enums";
import { isAuthenticated } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { sweepStaleTasks } from "@/services/tasks";

/** One cheap watermark for the database-backed pages; the client fetches full data only when it moves. */
export async function GET() {
  if (!await isAuthenticated()) return Response.json({ error: "Unauthorized." }, { status: 401 });
  await sweepStaleTasks();
  const database = getPrisma();
  const [intake, opportunity, track, draft, sweep, post, task, followUp, exposure, mailScan, exposureApplication, autopilot, tasks] = await Promise.all([
    database.jobIntake.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    database.opportunity.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    database.applicationTrack.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    database.outreachDraft.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    database.sweep.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    database.sweepPost.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    database.task.findFirst({ orderBy: { finishedAt: "desc" }, select: { startedAt: true, finishedAt: true } }),
    database.followUpSuggestion.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    database.exposureState.findUnique({ where: { id: "primary" }, select: { updatedAt: true } }),
    database.mailScanState.findUnique({ where: { id: "primary" }, select: { updatedAt: true } }),
    database.exposureApplication.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    database.autopilotControl.findUnique({ where: { id: "primary" }, select: { updatedAt: true } }),
    database.task.findMany({
      where: { silent: false, OR: [{ status: TaskStatus.RUNNING }, { finishedAt: { gte: new Date(Date.now() - 5 * 60_000) } }] },
      orderBy: { startedAt: "desc" }, take: 12,
      select: { id: true, status: true, label: true, href: true, progress: true, error: true, finishedAt: true },
    }),
  ]);
  const dates = [intake?.updatedAt, opportunity?.updatedAt, track?.updatedAt, draft?.updatedAt, sweep?.updatedAt, post?.createdAt, task?.startedAt, task?.finishedAt, followUp?.updatedAt, exposure?.updatedAt, mailScan?.updatedAt, exposureApplication?.createdAt, autopilot?.updatedAt].filter((date): date is Date => Boolean(date));
  const changedAt = dates.length ? new Date(Math.max(...dates.map((date) => date.getTime()))).toISOString() : null;
  return Response.json({ changedAt, tasks }, { headers: { "Cache-Control": "no-store" } });
}
