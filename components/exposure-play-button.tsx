import { runExposureNow, stopExposure } from "@/app/(protected)/exposure/actions";
import { HoverLabel, labelScope } from "@/components/hover-label";

// One round button that is either play or pause. The picture carries the state; the words live in the
// tooltip and the accessible name, so nothing is lost for a screen reader.

function PlayIcon() {
  return <svg aria-hidden className="ml-0.5 h-1/2 w-1/2" fill="currentColor" viewBox="0 0 24 24"><path d="M7 4.5v15a1 1 0 0 0 1.52.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 7 4.5Z" /></svg>;
}

function PauseIcon() {
  return <svg aria-hidden className="h-1/2 w-1/2" fill="currentColor" viewBox="0 0 24 24"><rect height="16" rx="1.5" width="4.5" x="5.5" y="4" /><rect height="16" rx="1.5" width="4.5" x="14" y="4" /></svg>;
}

export function ExposurePlayButton({ running, stopping, blockedReason, back, size = "large" }: {
  running: boolean;
  stopping: boolean;
  /** Why a run cannot start (mode off, Chrome not running); null when it can. */
  blockedReason: string | null;
  back?: "/dashboard";
  size?: "large" | "small";
}) {
  const box = size === "large" ? "h-14 w-14" : "h-9 w-9";
  const label = running ? (stopping ? "Stopping after this step" : "Pause: stop after this step") : blockedReason ?? "Start a run now";
  const tone = running
    ? stopping ? "bg-slate-300 text-white" : "bg-sky-600 text-white hover:bg-sky-700"
    : blockedReason ? "border-2 border-slate-300 bg-white text-slate-300" : "bg-emerald-600 text-white hover:bg-emerald-700";

  return (
    <form action={running ? stopExposure : runExposureNow} className="relative shrink-0">
      {back && <input name="back" type="hidden" value={back} />}
      {/* A slowly turning ring says "working" without a word. */}
      {running && <span aria-hidden className={`absolute -inset-1 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600 [animation-duration:2s]`} />}
      <button
        aria-label={label}
        className={`relative ${labelScope.bar} flex items-center justify-center rounded-full shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed ${box} ${tone}`}
        disabled={stopping || (!running && Boolean(blockedReason))}
        title={label}
        type="submit"
      >
        {running ? <PauseIcon /> : <PlayIcon />}
        <HoverLabel scope="bar" text={label} />
      </button>
    </form>
  );
}
