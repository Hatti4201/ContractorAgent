import Link from "next/link";
import { CircleAlert, RotateCw } from "lucide-react";
import { aiCapacityAlerts } from "@/services/ai-recovery";
import { formatDateTime } from "@/lib/job-values";

/** One compact dashboard notice for every provider-capacity failure; details stay one click away. */
export async function AiCapacityNotice() {
  const alerts = await aiCapacityAlerts();
  if (!alerts.length) return null;
  const visible = alerts.slice(0, 4);
  return (
    <section aria-labelledby="ai-capacity-notice" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950" role="alert">
      <div className="flex items-start gap-3">
        <CircleAlert aria-hidden="true" className="mt-0.5 shrink-0 text-amber-700" size={18} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold" id="ai-capacity-notice">AI 额度/限流：{alerts.length} 项等待恢复</h2>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-800"><RotateCw aria-hidden="true" size={13} /> 每 15 分钟自动重试</span>
          </div>
          <p className="mt-1 text-sm">充值或额度恢复后，系统会自动重跑仍未完成的分析；已发送的内容不会重复发送。</p>
          <ul className="mt-2 space-y-1 text-xs text-amber-900">
            {visible.map((alert) => <li key={alert.id}><Link className="font-semibold underline" href={alert.href}>{alert.label}</Link> · {formatDateTime(alert.at)}</li>)}
          </ul>
          {alerts.length > visible.length && <p className="mt-1 text-xs">另有 {alerts.length - visible.length} 项等待恢复。</p>}
        </div>
      </div>
    </section>
  );
}
