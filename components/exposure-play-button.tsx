"use client";

import { runExposureNow, stopExposure } from "@/app/(protected)/exposure/actions";
import { HoverLabel, labelScope } from "@/components/hover-label";
import { useFormStatus } from "react-dom";

// One round button that is either play or pause. The picture carries the state; the words live in the
// tooltip and the accessible name, so nothing is lost for a screen reader.

function PlayIcon() {
  return <svg aria-hidden className="ml-0.5 h-1/2 w-1/2" fill="currentColor" viewBox="0 0 24 24"><path d="M7 4.5v15a1 1 0 0 0 1.52.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 7 4.5Z" /></svg>;
}

function PauseIcon() {
  return <svg aria-hidden className="h-1/2 w-1/2" fill="currentColor" viewBox="0 0 24 24"><rect height="16" rx="1.5" width="4.5" x="5.5" y="4" /><rect height="16" rx="1.5" width="4.5" x="14" y="4" /></svg>;
}

export function ExposurePlayButton({ running, stopping, starting = false, blockedReason, back, size = "large" }: {
  running: boolean;
  stopping: boolean;
  starting?: boolean;
  /** Why a run cannot start (mode off, Chrome not running); null when it can. */
  blockedReason: string | null;
  back?: "/dashboard";
  size?: "large" | "small";
}) {
  return (
    <form action={running ? stopExposure : runExposureNow} className="relative flex shrink-0 items-center gap-2">
      {back && <input name="back" type="hidden" value={back} />}
      <ExposureSubmitButton blockedReason={blockedReason} running={running} size={size} starting={starting} stopping={stopping} />
    </form>
  );
}

function ExposureSubmitButton({ running, stopping, starting, blockedReason, size }: {
  running: boolean;
  stopping: boolean;
  starting: boolean;
  blockedReason: string | null;
  size: "large" | "small";
}) {
  const { pending } = useFormStatus();
  const isStarting = starting || (pending && !running);
  const box = size === "large" ? "h-14 w-14" : "h-9 w-9";
  const label = isStarting ? "Starting Dice exposure…" : running ? (stopping ? "Stopping after this step" : "Pause: stop after this step") : blockedReason ?? "Start a run now";
  const tone = isStarting ? "bg-emerald-600 text-white" : running
    ? stopping ? "bg-slate-300 text-white" : "bg-sky-600 text-white hover:bg-sky-700"
    : blockedReason ? "border-2 border-slate-300 bg-white text-slate-300" : "bg-emerald-600 text-white hover:bg-emerald-700";

  return (
    <>
      <span className="relative inline-flex">
        {/* Radar ring: pulse, sweep and signal points make the active state readable at a glance. */}
        {(running || isStarting) && (
          <span aria-hidden className="exposure-radar absolute -inset-2 pointer-events-none">
            <span className="exposure-radar__ring exposure-radar__ring--outer" />
            <span className="exposure-radar__ring exposure-radar__ring--inner" />
            <span className="exposure-radar__sweep" />
            <span className="exposure-radar__point exposure-radar__point--one" />
            <span className="exposure-radar__point exposure-radar__point--two" />
          </span>
        )}
        <button
          aria-label={label}
          className={`relative z-10 ${labelScope.bar} flex items-center justify-center rounded-full shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed ${box} ${tone}`}
          disabled={pending || stopping || (!running && Boolean(blockedReason))}
          title={label}
          type="submit"
        >
          {isStarting ? <span aria-hidden className="exposure-radar__core" /> : running ? <PauseIcon /> : <PlayIcon />}
          <HoverLabel scope="bar" text={label} />
        </button>
      </span>
      {isStarting && <span aria-live="polite" className="text-xs font-medium text-sky-900">Starting…</span>}
    </>
  );
}
