"use client";

import { useEffect, useState } from "react";

function clock(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function ExposureCountdown({ targetMs }: { targetMs: number }) {
  const [remaining, setRemaining] = useState(() => targetMs - Date.now());

  useEffect(() => {
    const update = () => setRemaining(targetMs - Date.now());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [targetMs]);

  return <span aria-live="polite" className="tabular-nums">{clock(remaining)}</span>;
}
