import { TaskStatus } from "@/app/generated/prisma/enums";
import { isAuthenticated } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { sweepStaleTasks } from "@/services/tasks";

const RECENT_MS = 60_000;

export async function GET() {
  if (!await isAuthenticated()) return Response.json({ error: "Unauthorized." }, { status: 401 });
  await sweepStaleTasks();
  const tasks = await getPrisma().task.findMany({
    where: {
      OR: [
        { status: TaskStatus.RUNNING },
        { finishedAt: { gte: new Date(Date.now() - RECENT_MS) } },
      ],
    },
    orderBy: { startedAt: "desc" },
    take: 12,
    select: { id: true, status: true, label: true, href: true, progress: true, error: true },
  });
  return Response.json({ tasks }, { headers: { "Cache-Control": "no-store" } });
}
