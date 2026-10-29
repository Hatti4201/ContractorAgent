"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export type SharedTask = {
  id: string;
  status: "RUNNING" | "DONE" | "FAILED";
  label: string;
  href: string | null;
  progress: string | null;
  error: string | null;
  finishedAt: string | null;
};

const StatusContext = createContext<SharedTask[]>([]);
const POLL_MS = 3_000;

export function StatusSubscriber({ children }: { children: ReactNode }) {
  const router = useRouter();
  const known = useRef<number | null>(null);
  const [tasks, setTasks] = useState<SharedTask[]>([]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch("/api/live/changes", { cache: "no-store" });
        if (active && response.ok) {
          const value = await response.json() as { changedAt?: string | null; tasks?: SharedTask[] };
          const changedAt = value.changedAt ? Date.parse(value.changedAt) : null;
          if (changedAt != null && known.current != null && changedAt > known.current) router.refresh();
          if (changedAt != null) known.current = changedAt;
          setTasks(value.tasks ?? []);
        }
      } catch {
        // The next poll retries; a temporary network failure should not interrupt the page.
      }
      if (active) timer = setTimeout(poll, POLL_MS);
    }
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [router]);

  return <StatusContext.Provider value={tasks}>{children}</StatusContext.Provider>;
}

export function useSharedTasks() {
  return useContext(StatusContext);
}
