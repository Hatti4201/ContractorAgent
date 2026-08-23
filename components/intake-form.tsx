"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const inputClass =
  "mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";

export function IntakeForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setAnalyzing(true);
    const formData = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/analyze-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: formData.get("rawText") }),
      });
      const result: unknown = await response.json();
      const data = result && typeof result === "object" ? result as { error?: unknown; reviewUrl?: unknown } : {};
      if (!response.ok || typeof data.reviewUrl !== "string") {
        throw new Error(typeof data.error === "string" ? data.error : "Analysis failed.");
      }
      router.push(data.reviewUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Analysis failed.");
      setAnalyzing(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={submit}>
      <label className="block rounded-2xl border border-slate-200 bg-white p-6 text-sm font-medium text-slate-800">
        Paste the job post, LinkedIn message, recruiter email, or forwarded JD <span aria-hidden="true" className="text-red-700">*</span>
        <textarea autoFocus className={inputClass} maxLength={50000} minLength={1} name="rawText" required rows={20} />
      </label>

      <p className="text-xs leading-5 text-slate-500">Source type, sender, and received time are detected from the text itself and stay editable on the review screen. Analyze sends this source to the configured OpenAI API over HTTPS with <code>store: false</code>. Nothing becomes CRM fact until you confirm the review.</p>
      {error && <p aria-live="polite" className="rounded-lg bg-red-50 p-3 text-sm font-medium text-red-800">{error}</p>}
      <button className="rounded-lg bg-slate-950 px-5 py-3 font-medium text-white hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60" disabled={analyzing} type="submit">
        {analyzing ? "Analyzing…" : "Analyze JD"}
      </button>
    </form>
  );
}
