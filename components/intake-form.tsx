"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const inputClass =
  "mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";

export function IntakeForm({ rows = 20, autoFocus = true, hint = true }: { rows?: number; autoFocus?: boolean; hint?: boolean } = {}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [queued, setQueued] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setAnalyzing(true);
    // Captured before the await: currentTarget is gone by the time the response lands.
    const form = event.currentTarget;
    const formData = new FormData(form);

    try {
      const response = await fetch("/api/analyze-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: formData.get("rawText") }),
      });
      const result: unknown = await response.json();
      const data = result && typeof result === "object" ? result as { error?: unknown; reviewUrl?: unknown } : {};
      if (!response.ok || typeof data.reviewUrl !== "string") {
        throw new Error(typeof data.error === "string" ? data.error : "Analysis could not be started.");
      }
      // The pipeline is already running behind the response, so the box is handed straight back
      // for the next paste instead of navigating away from it.
      form.reset();
      setQueued((count) => count + 1);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Analysis failed.");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={submit}>
      <label className="block text-sm font-medium text-slate-800">
        Paste the job post, LinkedIn message, recruiter email, or forwarded JD <span aria-hidden="true" className="text-red-700">*</span>
        <textarea autoFocus={autoFocus} className={inputClass} maxLength={50000} minLength={1} name="rawText" required rows={rows} />
      </label>

      {hint && <p className="text-xs leading-5 text-slate-500">Analyze starts a background task: source detection, analysis, resume routing, drafting and validation all run without holding this page. Watch its progress in the corner and open the review when it finishes. Requests go to the configured OpenAI API over HTTPS with <code>store: false</code>, and nothing becomes CRM fact until you confirm.</p>}
      {queued > 0 && <p aria-live="polite" className="rounded-lg bg-emerald-50 p-3 text-sm font-medium text-emerald-900" role="status">{queued === 1 ? "Sent to the background." : `${queued} sources sent to the background.`} Progress is in the corner tray, and each one waits for you in the review queue. Paste the next one whenever you like.</p>}
      {error && <p aria-live="polite" className="rounded-lg bg-red-50 p-3 text-sm font-medium text-red-800">{error}</p>}
      <button className="rounded-lg bg-slate-950 px-5 py-3 font-medium text-white hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60" disabled={analyzing} type="submit">
        {analyzing ? "Starting…" : "Analyze JD"}
      </button>
    </form>
  );
}
