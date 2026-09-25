"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the server page on an interval while something is running; idle pages stay still. */
export function AutoRefresh({ active, everyMs = 5_000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs, router]);
  return null;
}
