import Link from "next/link";
import { Bot, CircleAlert, RotateCw } from "lucide-react";
import { formatDateTime } from "@/lib/job-values";

type Incident = {
  status: string;
  severity: string | null;
  summary: string | null;
  diagnosis: string | null;
  recommendedAction: string | null;
  needsUser: boolean | null;
  safeToRecover: boolean | null;
  codexHandoff: string | null;
  updatedAt: Date;
  event: { occurredAt: Date; data: unknown };
};

function componentName(data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "agent";
  const value = (data as { component?: unknown }).component;
  return typeof value === "string" ? value : "agent";
}

function eventHref(data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const value = (data as { href?: unknown }).href;
  return typeof value === "string" && value.startsWith("/") ? value : null;
}

export function AiIncidentNotice({ incident }: { incident: Incident | null }) {
  if (!incident) return null;
  const urgent = incident.needsUser || ["ACTION_REQUIRED", "BLOCKED", "ERROR"].includes(incident.severity ?? "");
  if (!urgent && incident.status === "COMPLETED") return null;
  const href = eventHref(incident.event.data);
  const tone = incident.needsUser || incident.severity === "ACTION_REQUIRED" ? "border-red-300 bg-red-50 text-red-950" : "border-amber-300 bg-amber-50 text-amber-950";

  return (
    <section aria-labelledby="ai-incident-notice" className={`mt-4 rounded-xl border px-4 py-3 ${tone}`} role="status">
      <div className="flex items-start gap-3">
        <Bot aria-hidden="true" className="mt-0.5 shrink-0" size={18} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold" id="ai-incident-notice">API Agent · {componentName(incident.event.data)} · {incident.severity ?? incident.status}</h2>
            {incident.status === "RUNNING" || incident.status === "PENDING" ? <span className="inline-flex items-center gap-1 text-xs font-medium"><RotateCw aria-hidden="true" size={13} />诊断中</span> : <span className="text-xs font-medium">{formatDateTime(incident.updatedAt)}</span>}
          </div>
          <p className="mt-1 text-sm">{incident.summary ?? incident.diagnosis ?? "API Agent 正在分析最近事件。"}</p>
          {incident.diagnosis && incident.summary && <p className="mt-1 text-xs opacity-80">{incident.diagnosis}</p>}
          {incident.recommendedAction && <p className="mt-2 text-sm font-medium">下一步：{incident.recommendedAction}</p>}
          {href && <Link className="mt-2 inline-block text-xs font-semibold underline" href={href}>打开相关页面</Link>}
          {incident.codexHandoff && <p className="mt-2 text-xs opacity-80">Codex：{incident.codexHandoff}</p>}
        </div>
        <CircleAlert aria-hidden="true" className="shrink-0" size={17} />
      </div>
    </section>
  );
}
