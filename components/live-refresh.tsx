"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

const POLL_MS = 3_000;

/** Polls one database watermark; full server data is fetched only after it changes. */
export function LiveRefresh() {
  const router = useRouter();
  const known = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch("/api/live/changes", { cache: "no-store" });
        if (active && response.ok) {
          const value = await response.json() as { changedAt?: string | null };
          const changedAt = value.changedAt ? Date.parse(value.changedAt) : null;
          if (changedAt != null && known.current != null && changedAt > known.current) router.refresh();
          if (changedAt != null) known.current = changedAt;
        }
      } catch {
        // The next poll retries; a temporary network failure should not interrupt the page.
      }
      if (active) timer = setTimeout(poll, POLL_MS);
    }
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [router]);

  return null;
}
