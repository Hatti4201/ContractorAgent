import Link from "next/link";
import { ArrowUpRight, CheckCircle2, Clock3, LoaderCircle, Mail, Send } from "lucide-react";
import { SendCountdown } from "@/components/send-countdown";
import { displayTimeZone } from "@/lib/job-values";
import { autopilotOverview } from "@/services/auto-send";

type Overview = Awaited<ReturnType<typeof autopilotOverview>>;

function timeLabel(value: Date | null) {
  if (!value) return "队列空";
  return new Intl.DateTimeFormat("en-US", { timeStyle: "short", timeZone: displayTimeZone() }).format(value);
}

/** Visual queue shared by the dashboard and Autopilot page; it never owns send decisions. */
export function OutlookSendQueue({ overview, compact = false }: { overview: Overview; compact?: boolean }) {
  const { upcoming, sentToday, limit } = overview;
  const sending = upcoming.find((draft) => draft.autoSendState === "SENDING");
  const next = upcoming.find((draft) => draft.autoSendState === "SCHEDULED");
  const focus = sending ?? next ?? upcoming[0] ?? null;
  const nextAt = next?.autoSendAt ?? null;
  const running = Boolean(sending);
  const title = running ? "发送中" : upcoming.length ? "下一封" : "队列空";
  const subtitle = focus ? focus.opportunity.title : "—";
  const dots = upcoming.slice(0, compact ? 12 : 18);

  return (
    <section aria-label="Outlook 自动发送队列" className={`relative overflow-hidden rounded-xl border border-sky-100 bg-sky-50/70 ${compact ? "mt-3 p-3" : "mt-4 p-4"}`}>
      <div className="flex items-center gap-3">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700">
          <span className="absolute inset-0 animate-ping rounded-full border border-sky-300/70" />
          {running ? <LoaderCircle aria-hidden="true" className="relative animate-spin" size={20} /> : <Send aria-hidden="true" className="relative" size={19} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
            <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold text-sky-800">{upcoming.length}</span>
          </div>
          <p className="truncate text-xs text-slate-600" title={subtitle}>{subtitle}</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-black tracking-tight text-sky-800"><SendCountdown targetMs={nextAt?.getTime() ?? null} /></div>
          <div className="text-[10px] font-semibold text-slate-500">{next ? `下一封 ${timeLabel(next.autoSendAt)}` : "自动继续"}</div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5" aria-label={`${upcoming.length} emails queued`}>
        {dots.map((draft) => <span className={`h-1.5 flex-1 rounded-full ${draft.autoSendState === "SENDING" ? "bg-sky-600 shadow-[0_0_0_3px_rgba(125,211,252,.55)]" : "bg-sky-200"}`} key={draft.id} />)}
        {upcoming.length > dots.length && <span className="text-[10px] font-bold text-sky-700">+{upcoming.length - dots.length}</span>}
      </div>

      <div className="mt-3 flex items-center gap-2 text-[11px] font-semibold text-slate-600">
        <span className="inline-flex items-center gap-1"><CheckCircle2 className="text-emerald-600" size={13} />{sentToday}/{limit}</span>
        <span className="text-slate-300">·</span>
        <span className="inline-flex items-center gap-1"><Clock3 className="text-sky-600" size={13} />{upcoming.length}</span>
        {!compact && <Link className="ml-auto inline-flex items-center gap-1 text-sky-800 hover:text-sky-950" href="/autopilot" title="打开 Autopilot"><Mail size={13} />详情<ArrowUpRight size={12} /></Link>}
      </div>
    </section>
  );
}
