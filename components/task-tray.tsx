"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Task = {
  id: string;
  kind: string;
  status: "RUNNING" | "DONE" | "FAILED";
  label: string;
  href: string | null;
  progress: string | null;
  error: string | null;
  finishedAt: string | null;
};

const POLL_MS = 2000;
// Covers the redirect and mount window, so a task that landed just before this tray existed still refreshes it.
const GRACE_MS = 10_000;
/** An open text field means the user is busy writing, and moving the page under them would be rude. */
function typing() {
  const active = document.activeElement;
  return active instanceof HTMLTextAreaElement || (active instanceof HTMLInputElement && active.type !== "submit");
}

const tone: Record<Task["status"], string> = {
  RUNNING: "border-slate-200 bg-white",
  DONE: "border-emerald-200 bg-emerald-50",
  FAILED: "border-red-200 bg-red-50",
};

export function TaskTray() {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const seen = useRef(new Map<string, Task["status"]>());
  const mountedAt = useRef(0);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    mountedAt.current = Date.now();

    async function poll() {
      try {
        const response = await fetch("/api/tasks", { cache: "no-store" });
        if (active && response.ok) {
          const data = await response.json() as { tasks?: Task[] };
          const next = data.tasks ?? [];
          // A task that just ended has already written its results, so the open page needs new data.
          // Work that finished before the first poll counts too: short tasks routinely beat it here,
          // which used to leave the page showing the state it was redirected with.
          let landed = false;
          let review: string | null = null;
          for (const task of next) {
            const before = seen.current.get(task.id);
            const justFinished = task.finishedAt !== null && Date.parse(task.finishedAt) >= mountedAt.current - GRACE_MS;
            if (task.status !== "RUNNING" && (before === "RUNNING" || (before === undefined && justFinished))) {
              landed = true;
              // A prepared source is only useful on its review screen, so go there instead of
              // making the user find the card -- unless they are mid-sentence in another paste.
              if (task.kind === "INTAKE_PIPELINE" && task.status === "DONE" && task.href && !review && !typing()) {
                review = task.href;
              }
            }
            seen.current.set(task.id, task.status);
          }
          if (review) router.push(review);
          else if (landed) router.refresh();
          setTasks(next);
        }
      } catch {
        // A failed poll is not worth surfacing; the next tick retries.
      }
      if (active) timer = setTimeout(poll, POLL_MS);
    }

    poll();
    return () => { active = false; clearTimeout(timer); };
  }, [router]);

  const visible = tasks.filter((task) => !dismissed.includes(task.id));
  if (!visible.length) return null;

  return (
    <div aria-label="Background tasks" aria-live="polite" className="fixed bottom-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] space-y-2">
      {visible.map((task) => (
        <article className={`rounded-xl border p-3 text-sm shadow-lg ${tone[task.status]}`} key={task.id}>
          <div className="flex items-start justify-between gap-3">
            <p className="font-medium text-slate-950">
              {task.status === "RUNNING" && <span aria-hidden="true" className="mr-2 inline-block animate-spin">◌</span>}
              {task.label}
            </p>
            <button
              aria-label="Dismiss task"
              className="text-slate-400 hover:text-slate-700"
              onClick={() => setDismissed((current) => [...current, task.id])}
              type="button"
            >
              ✕
            </button>
          </div>
          {task.progress && <p className="mt-1 text-xs text-slate-600">{task.progress}</p>}
          {task.error && <p className="mt-1 text-xs font-medium text-red-800">{task.error}</p>}
          {task.status === "DONE" && task.href && (
            <Link className="mt-2 inline-block text-xs font-medium text-emerald-700 underline" href={task.href}>Open result</Link>
          )}
        </article>
      ))}
    </div>
  );
}
