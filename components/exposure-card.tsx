import Link from "next/link";
import { ExposureResult } from "@/app/generated/prisma/enums";
import { AutoRefresh } from "@/components/auto-refresh";
import { exposureRunning, exposureState, loadExposureConfig, recentCounts } from "@/services/exposure-run";

const modeLabel = { off: "Off", dryrun: "Dry run", on: "On" } as const;

/** Dashboard summary of the Dice exposure channel; all controls live on /exposure. */
export async function ExposureCard() {
  const [state, config, count] = await Promise.all([exposureState(), loadExposureConfig(), recentCounts()]);
  const running = exposureRunning();
  const stopped = state.consecutiveFailures > 0;
  const tone = stopped ? "border-red-200 bg-red-50" : running ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-white";

  return (
    <section aria-labelledby="exposure-card" className={`mb-8 rounded-2xl border p-5 shadow-sm ${tone}`}>
      <AutoRefresh active={running} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-950" id="exposure-card">Dice exposure</h2>
        <span className="text-sm font-medium text-slate-700">{modeLabel[config.mode]}{running ? " · running" : ""}</span>
      </div>
      {running && <p className="mt-2 text-sm text-sky-950">{state.progress ?? "Starting"}</p>}
      {stopped && <p className="mt-2 text-sm font-medium text-red-900" role="alert">Stopped: {state.lastError ?? "reason unknown"}</p>}
      <p className="mt-2 text-sm text-slate-700">
        Last 24 hours: <span className="font-semibold text-slate-950">{count(ExposureResult.APPLIED)}</span> applied ·{" "}
        <span className="font-semibold text-slate-950">{count(ExposureResult.DRY_RUN_READY)}</span> dry run ·{" "}
        <span className="font-semibold text-slate-950">{count(ExposureResult.SKIPPED)}</span> skipped ·{" "}
        <span className="font-semibold text-slate-950">{count(ExposureResult.FAILED)}</span> failed
      </p>
      <Link className="mt-3 inline-block rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:border-slate-500" href="/exposure">Open exposure console</Link>
    </section>
  );
}
