"use client";

import { useEffect, useState } from "react";

function clock(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function SendCountdown({ targetMs }: { targetMs: number | null }) {
  const [remaining, setRemaining] = useState(() => targetMs === null ? 0 : targetMs - Date.now());

  useEffect(() => {
    const update = () => setRemaining(targetMs === null ? 0 : targetMs - Date.now());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [targetMs]);

  return <span aria-live="polite" className="tabular-nums">{targetMs === null ? "—" : clock(remaining)}</span>;
}
