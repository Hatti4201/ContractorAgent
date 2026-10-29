import Link from "next/link";
import { ArrowUpRight, CheckCircle2, CircleX, FlaskConical, Radar, RotateCw, SkipForward, Square, Zap } from "lucide-react";
import { dismissExposureError } from "@/app/(protected)/exposure/actions";
import { ExposureResult } from "@/app/generated/prisma/enums";
import { ExposureCountdown } from "@/components/exposure-countdown";
import { ExposurePlayButton } from "@/components/exposure-play-button";
import { HoverLabel, labelScope } from "@/components/hover-label";
import { formatDateTime } from "@/lib/job-values";
import { chromeReachable } from "@/services/cdp";
import { isExpectedExposureStop } from "@/services/exposure-rules";
import { exposureRunning, loadExposureConfig, readExposureState, recentCounts } from "@/services/exposure-run";
import { nextScheduledScanAt } from "@/services/mail-schedule";

const modeMeta = {
  off: { icon: Square, label: "Off", tone: "text-slate-400" },
  dryrun: { icon: FlaskConical, label: "Dry run", tone: "text-amber-600" },
  on: { icon: Zap, label: "On", tone: "text-emerald-600" },
} as const;

const resultMeta = [
  { result: ExposureResult.APPLIED, icon: CheckCircle2, label: "Applied" },
  { result: ExposureResult.DRY_RUN_READY, icon: FlaskConical, label: "Dry run" },
  { result: ExposureResult.SKIPPED, icon: SkipForward, label: "Skipped" },
  { result: ExposureResult.FAILED, icon: CircleX, label: "Failed" },
] as const;

/** Dashboard summary of the Dice exposure channel; all controls live on /exposure. */
export async function ExposureCard() {
  const [state, config, count] = await Promise.all([readExposureState(), loadExposureConfig(), recentCounts()]);
  const chrome = await chromeReachable(config.cdpUrl);
  const running = exposureRunning(state);
  const errorAt = state.lastErrorAt ?? state.updatedAt;
  const expectedStop = isExpectedExposureStop(state.lastStopReason) || isExpectedExposureStop(state.lastError);
  const stopped = !expectedStop && state.consecutiveFailures > 0 && Boolean(state.lastError) && (!state.errorClearedAt || errorAt > state.errorClearedAt);
  const nextRunAt = nextScheduledScanAt(new Date(), state.lastRunAt ?? state.lastStopAt, config.window);
  const waiting = !running && expectedStop && Boolean(nextRunAt);
  const tone = stopped ? "border-red-200 bg-red-50" : waiting || running ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-white";

  return (
    <section aria-labelledby="exposure-card" className={`mb-4 rounded-2xl border px-4 py-3 shadow-sm ${tone}`}>
      <div className="flex items-start gap-3">
        {waiting ? (
          <div aria-hidden="true" className="relative mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700">
            <span className="absolute inset-0 animate-ping rounded-full border border-sky-300/70" />
            <RotateCw className="relative animate-pulse" size={22} />
          </div>
        ) : (
          <ExposurePlayButton
            back="/dashboard"
            blockedReason={config.mode === "off" ? "Mode is Off: set it on /exposure" : !chrome ? "Dedicated Chrome not running" : null}
            running={running}
            size="small"
            starting={state.progress === "Starting"}
            stopping={state.stopRequested}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Radar aria-hidden="true" className="text-slate-500" size={17} />
            <h2 className="text-sm font-semibold text-slate-950" id="exposure-card">Dice</h2>
            {waiting && <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800"><RotateCw aria-hidden="true" size={12} />下一轮即将开始</span>}
            {running && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800">运行中</span>}
          </div>

          {waiting && nextRunAt ? (
            <div className="mt-2 flex flex-wrap items-end gap-x-5 gap-y-2">
              <div>
                <div className="text-3xl font-semibold tracking-tight text-slate-950"><ExposureCountdown targetMs={nextRunAt.getTime()} /></div>
                <p className="text-xs font-medium text-sky-900">倒计时结束后自动开始</p>
              </div>
              <div className="pb-1 text-xs font-semibold text-slate-500" aria-label="Dice round status">
                <span className="text-emerald-700">✓ 已完成</span><span className="px-1.5 text-slate-300">→</span><span className="text-sky-700">◷ 倒计时</span><span className="px-1.5 text-slate-300">→</span><span>立即开始</span>
              </div>
            </div>
          ) : running ? (
            <p className="mt-1 truncate text-xs text-sky-950" title={state.progress ?? "Starting"}>{state.progress ?? "Starting"}</p>
          ) : expectedStop ? (
            <p className="mt-1 text-xs font-medium text-sky-900" title={state.lastStopReason ?? "Dice round ended"}>本轮已完成 · {formatDateTime(state.lastStopAt ?? errorAt)}</p>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {resultMeta.map(({ result, icon: Icon, label }) => (
              <span aria-label={`${label}: ${count(result)} in the last 24 hours`} className="inline-flex items-center gap-1 rounded-lg bg-white/70 px-2 py-1 text-xs font-semibold text-slate-700" key={result} title={`${label} · last 24 hours`}>
                <Icon aria-hidden="true" className="text-slate-500" size={13} />{count(result)}
              </span>
            ))}
          </div>
          {stopped && <span className="mt-2 inline-flex min-w-0 items-center gap-1 text-xs font-medium text-red-900" role="alert" title={state.lastError ?? "Dice exposure stopped"}><CircleX aria-hidden="true" size={13} />Stopped · {formatDateTime(errorAt)} <form action={dismissExposureError}><button aria-label="Dismiss Dice exposure error" className="rounded p-0.5 hover:bg-red-100" title="Dismiss this error" type="submit">×</button></form></span>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {(() => { const { icon: Icon, label, tone: modeTone } = modeMeta[config.mode]; return <span aria-label={`Dice mode: ${label}`} className={`inline-flex items-center gap-1 text-xs font-semibold ${modeTone}`} title={`Mode: ${label}`}><Icon aria-hidden="true" size={14} />{running ? "●" : ""}</span>; })()}
          <Link aria-label="Open Dice exposure" className={`relative ${labelScope.bar} rounded-lg border border-slate-300 bg-white p-1.5 text-slate-700 hover:border-slate-500`} href="/exposure" title="Open Dice exposure">
            <ArrowUpRight aria-hidden="true" size={15} />
            <HoverLabel scope="bar" text="打开 Dice" />
          </Link>
        </div>
      </div>
    </section>
  );
}
