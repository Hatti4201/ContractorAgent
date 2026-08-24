import { logoutAction } from "@/app/(protected)/actions";
import { Navigation } from "@/components/navigation";
import { TaskTray } from "@/components/task-tray";
import { requireAuth } from "@/lib/auth";
import { countNeedsAttention } from "@/services/attention";
import { countQueuedIntakes } from "@/services/intake-queue";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  await requireAuth();
  const [attentionCount, intakeCount] = await Promise.all([countNeedsAttention(), countQueuedIntakes()]);

  return (
    <>
      <Navigation attentionCount={attentionCount} intakeCount={intakeCount} logoutAction={logoutAction} />
      {/* Bottom padding keeps the task tray from covering the end of a page. */}
      <main className="pb-24">{children}</main>
      <TaskTray />
    </>
  );
}
