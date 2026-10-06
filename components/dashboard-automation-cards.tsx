import Link from "next/link";
import { ArrowUpRight, Bot, CircleAlert, MailSearch, Pause, Play } from "lucide-react";
import { TaskKind, TaskStatus } from "@/app/generated/prisma/enums";
import { formatDateTime } from "@/lib/job-values";
import { getPrisma } from "@/lib/prisma";
import { autopilotOverview, currentAutopilotMode } from "@/services/auto-send";
import { waitingForAutopilot } from "@/services/autopilot-batch";
import { mailScanState } from "@/services/follow-up-scan";
import { scanWindowFromEnv } from "@/services/mail-schedule";

const taskStatus = { status: TaskStatus.RUNNING } as const;
const modeLabel = { off: "Off", draft: "Drafts", shadow: "Drafts", send: "Send" } as const;

export async function DashboardAutomationCards() {
  const database = getPrisma();
  const [mode, overview, waiting, autopilotTask, scan, scanTask] = await Promise.all([
    currentAutopilotMode(),
    autopilotOverview(),
    waitingForAutopilot(),
    database.task.findFirst({ where: { kind: { in: [TaskKind.AUTOPILOT_BATCH, TaskKind.AUTO_SEND] }, ...taskStatus }, orderBy: { startedAt: "desc" } }),
    mailScanState(),
    database.task.findFirst({ where: { kind: TaskKind.FOLLOW_UP_SCAN, ...taskStatus }, orderBy: { startedAt: "desc" } }),
  ]);
  const scanWindow = scanWindowFromEnv();
  const autopilotRunning = Boolean(autopilotTask);
  const scanRunning = Boolean(scanTask);
  const autopilotTone = autopilotRunning ? "border-sky-200 bg-sky-50" : mode === "off" ? "border-slate-200 bg-white" : "border-emerald-200 bg-emerald-50";
  const scanTone = scanRunning ? "border-sky-200 bg-sky-50" : scan.consecutiveFailures > 0 ? "border-red-200 bg-red-50" : scanWindow.enabled ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50";

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <section aria-labelledby="autopilot-dashboard-card" className={`rounded-xl border px-4 py-3 shadow-sm ${autopilotTone}`}>
        <div className="flex items-center gap-3">
          <Bot aria-hidden="true" className={autopilotRunning ? "text-sky-700" : "text-slate-500"} size={19} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-950" id="autopilot-dashboard-card">Autopilot</h2>
              <span className={`inline-flex items-center gap-1 text-xs font-semibold ${autopilotRunning ? "text-sky-800" : mode === "off" ? "text-slate-500" : "text-emerald-800"}`}>
                {autopilotRunning ? <Play aria-hidden="true" size={13} /> : mode === "off" ? <Pause aria-hidden="true" size={13} /> : <span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-500" />}
                {autopilotRunning ? "Running" : mode === "off" ? "Off" : "Ready"} · {modeLabel[mode]}
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-slate-600" title={autopilotTask?.progress ?? undefined}>
              {autopilotRunning ? autopilotTask?.progress ?? "Processing jobs" : mode === "off" ? "Waiting for Autopilot to be enabled" : `${overview.upcoming.length} queued · ${waiting.length} waiting`}
            </p>
          </div>
          <Link aria-label="Open Autopilot" className="rounded-lg border border-slate-300 bg-white p-1.5 text-slate-700 hover:border-slate-500" href="/autopilot" title="Open Autopilot">
            <ArrowUpRight aria-hidden="true" size={15} />
          </Link>
        </div>
      </section>

      <section aria-labelledby="mail-scan-dashboard-card" className={`rounded-xl border px-4 py-3 shadow-sm ${scanTone}`}>
        <div className="flex items-center gap-3">
          <MailSearch aria-hidden="true" className={scanRunning ? "text-sky-700" : "text-slate-500"} size={19} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-950" id="mail-scan-dashboard-card">Outlook scan</h2>
              <span className={`inline-flex items-center gap-1 text-xs font-semibold ${scanRunning ? "text-sky-800" : scan.consecutiveFailures > 0 ? "text-red-800" : scanWindow.enabled ? "text-slate-700" : "text-slate-500"}`}>
                {scanRunning ? <Play aria-hidden="true" size={13} /> : scan.consecutiveFailures > 0 ? <CircleAlert aria-hidden="true" size={13} /> : <span aria-hidden="true" className="h-2 w-2 rounded-full bg-slate-400" />}
                {scanRunning ? "Scanning" : scan.consecutiveFailures > 0 ? "Failed" : scanWindow.enabled ? "Idle" : "Paused"}
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-slate-600" title={scanTask?.progress ?? scan.lastError ?? undefined}>
              {scanRunning ? scanTask?.progress ?? "Reading Outlook mail" : scan.lastSuccessAt ? `Last scan ${formatDateTime(scan.lastSuccessAt)}` : scanWindow.enabled ? "No successful scan yet" : "Scheduled scanning is off"}
            </p>
          </div>
          <Link aria-label="Open Outlook mail scan" className="rounded-lg border border-slate-300 bg-white p-1.5 text-slate-700 hover:border-slate-500" href="/needs-attention" title="Open mail scan">
            <ArrowUpRight aria-hidden="true" size={15} />
          </Link>
        </div>
      </section>
    </div>
  );
}
