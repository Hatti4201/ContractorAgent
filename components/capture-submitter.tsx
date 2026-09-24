"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "contractor-agent-capture";
type Capture = { k: string; t: string; u: string };
type State = { kind: "working" | "sent" | "empty" | "failed"; message?: string; preview?: string };

/** Moves the fragment into this tab's storage, so a sign-in detour keeps it and a reload does not resend it. */
function takeCapture(): Capture | null {
  const params = new URLSearchParams(window.location.hash.slice(1));
  if (params.get("t")) {
    const capture = { k: params.get("k") ?? "", t: params.get("t") ?? "", u: params.get("u") ?? "" };
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(capture)); } catch { /* storage blocked: submit from memory */ }
    // The key and the text leave the address bar and the tab's history entry.
    history.replaceState(null, "", window.location.pathname);
    return capture;
  }
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) as Capture : null;
  } catch { return null; }
}

function forget() {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* nothing stored */ }
}

export function CaptureSubmitter() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "working" });
  // Strict Mode runs this effect twice in development, and the capture is still stored for the second.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const capture = takeCapture();
      if (!capture) { setState({ kind: "empty" }); return; }
      const preview = capture.t.slice(0, 280);
      try {
        const response = await fetch("/api/capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: capture.k, text: capture.t, url: capture.u }),
        });
        // Signed out: sign in, and the kept capture is sent when this page comes back.
        if (response.status === 401) { router.replace("/login?next=capture"); return; }
        const data = await response.json().catch(() => ({})) as { error?: unknown };
        if (!response.ok) {
          forget();
          setState({ kind: "failed", preview, message: typeof data.error === "string" ? data.error : "The capture could not be sent." });
          return;
        }
        forget();
        setState({ kind: "sent", preview });
        // A tab a script opened may close itself; if the browser refuses, the message stays.
        setTimeout(() => window.close(), 2500);
      } catch {
        setState({ kind: "failed", preview, message: "The app could not be reached." });
      }
    })();
  }, [router]);

  return (
    <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">LinkedIn → Agent</p>
      <h1 className="mt-2 text-2xl font-semibold text-slate-950" role="status">
        {state.kind === "working" && "Sending…"}
        {state.kind === "sent" && "Sent to the agent"}
        {state.kind === "empty" && "Nothing to send"}
        {state.kind === "failed" && "Not sent"}
      </h1>
      {state.kind === "sent" && <p className="mt-2 text-sm text-slate-600">It is in the job pool now, and the autopilot takes it from here. This tab closes itself.</p>}
      {state.kind === "empty" && <p className="mt-2 text-sm text-slate-600">Select a post&apos;s text on LinkedIn, then click the bookmarklet.</p>}
      {state.kind === "failed" && <p className="mt-2 text-sm font-medium text-red-700">{state.message}</p>}
      {state.preview && <blockquote className="mt-4 whitespace-pre-wrap border-l-4 border-slate-200 pl-3 text-sm text-slate-500">{state.preview}{state.preview.length >= 280 ? "…" : ""}</blockquote>}
    </section>
  );
}
