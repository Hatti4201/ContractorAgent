import Link from "next/link";
import { ArrowUpRight, CheckCircle2, CircleX, FlaskConical, Radar, SkipForward, Square, Zap } from "lucide-react";
import { dismissExposureError } from "@/app/(protected)/exposure/actions";
import { ExposureResult } from "@/app/generated/prisma/enums";
import { AutoRefresh } from "@/components/auto-refresh";
import { ExposurePlayButton } from "@/components/exposure-play-button";
import { HoverLabel, labelScope } from "@/components/hover-label";
import { formatDateTime } from "@/lib/job-values";
import { chromeReachable } from "@/services/cdp";
import { exposureRunning, exposureState, loadExposureConfig, recentCounts } from "@/services/exposure-run";

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
  const [state, config, count] = await Promise.all([exposureState(), loadExposureConfig(), recentCounts()]);
  const chrome = await chromeReachable(config.cdpUrl);
  const running = exposureRunning(state);
  const errorAt = state.lastErrorAt ?? state.updatedAt;
  const stopped = state.consecutiveFailures > 0 && Boolean(state.lastError) && (!state.errorClearedAt || errorAt > state.errorClearedAt);
  const tone = stopped ? "border-red-200 bg-red-50" : running ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-white";

  return (
    <section aria-labelledby="exposure-card" className={`mb-4 rounded-xl border px-3 py-2.5 shadow-sm ${tone}`}>
      <AutoRefresh active={running} />
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <ExposurePlayButton
            back="/dashboard"
            blockedReason={config.mode === "off" ? "Mode is Off: set it on /exposure" : !chrome ? "Dedicated Chrome not running" : null}
            running={running}
            size="small"
            stopping={state.stopRequested}
          />
          <Radar aria-hidden="true" className="text-slate-500" size={17} />
          <h2 className="text-sm font-semibold text-slate-950" id="exposure-card">Dice</h2>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {resultMeta.map(({ result, icon: Icon, label }) => (
            <span aria-label={`${label}: ${count(result)} in the last 24 hours`} className="inline-flex items-center gap-1 rounded-lg bg-white/70 px-2 py-1 text-xs font-semibold text-slate-700" key={result} title={`${label} · last 24 hours`}>
              <Icon aria-hidden="true" className="text-slate-500" size={13} />{count(result)}
            </span>
          ))}
          {running && <span className="min-w-0 truncate text-xs text-sky-950" title={state.progress ?? "Starting"}>{state.progress ?? "Starting"}</span>}
          {stopped && <span className="inline-flex min-w-0 items-center gap-1 text-xs font-medium text-red-900" role="alert" title={state.lastError ?? "Dice exposure stopped"}><CircleX aria-hidden="true" size={13} />Stopped · {formatDateTime(errorAt)} <form action={dismissExposureError}><button aria-label="Dismiss Dice exposure error" className="rounded p-0.5 hover:bg-red-100" title="Dismiss this error" type="submit">×</button></form></span>}
        </div>
        {(() => { const { icon: Icon, label, tone: modeTone } = modeMeta[config.mode]; return <span aria-label={`Dice mode: ${label}`} className={`inline-flex items-center gap-1 text-xs font-semibold ${modeTone}`} title={`Mode: ${label}`}><Icon aria-hidden="true" size={14} />{running ? "●" : ""}</span>; })()}
        <Link aria-label="Open Dice exposure" className={`relative ${labelScope.bar} rounded-lg border border-slate-300 bg-white p-1.5 text-slate-700 hover:border-slate-500`} href="/exposure" title="Open Dice exposure">
          <ArrowUpRight aria-hidden="true" size={15} />
          <HoverLabel scope="bar" text="打开 Dice" />
        </Link>
      </div>
    </section>
  );
}
