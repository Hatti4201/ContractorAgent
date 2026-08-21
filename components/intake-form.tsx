"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { formatEnum, jobSourceTypes } from "@/lib/job-values";

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
    const receivedAt = String(formData.get("receivedAt") ?? "");
    const attachments = String(formData.get("attachments") ?? "")
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean);

    try {
      const response = await fetch("/api/analyze-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceType: formData.get("sourceType"),
          rawText: formData.get("rawText"),
          originalSender: formData.get("originalSender"),
          receivedAt: receivedAt ? new Date(`${receivedAt}:00.000Z`).toISOString() : undefined,
          attachments,
        }),
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
      <fieldset className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-6 md:grid-cols-2">
        <legend className="px-2 text-lg font-semibold text-slate-950">Source</legend>
        <label className="text-sm font-medium text-slate-800">
          Source type
          <select className={inputClass} defaultValue="PLAIN_TEXT" name="sourceType">
            {jobSourceTypes.map((value) => <option key={value} value={value}>{formatEnum(value)}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-800">
          Received at (UTC)
          <input className={inputClass} name="receivedAt" type="datetime-local" />
        </label>
        <label className="text-sm font-medium text-slate-800 md:col-span-2">
          Original sender
          <input className={inputClass} maxLength={500} name="originalSender" placeholder="Leave blank when unknown" />
        </label>
        <label className="text-sm font-medium text-slate-800 md:col-span-2">
          Attachment filenames or labels, one per line
          <textarea className={inputClass} maxLength={5000} name="attachments" rows={3} />
        </label>
      </fieldset>

      <label className="block rounded-2xl border border-slate-200 bg-white p-6 text-sm font-medium text-slate-800">
        Job post, message, email, or JD <span aria-hidden="true" className="text-red-700">*</span>
        <textarea className={inputClass} maxLength={50000} minLength={1} name="rawText" required rows={16} />
      </label>

      <p className="text-xs leading-5 text-slate-500">Analyze sends this source to the configured OpenAI API over HTTPS with <code>store: false</code>. Nothing becomes CRM fact until you confirm the review.</p>
      {error && <p aria-live="polite" className="rounded-lg bg-red-50 p-3 text-sm font-medium text-red-800">{error}</p>}
      <button className="rounded-lg bg-slate-950 px-5 py-3 font-medium text-white hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60" disabled={analyzing} type="submit">
        {analyzing ? "Analyzing…" : "Analyze JD"}
      </button>
    </form>
  );
}
