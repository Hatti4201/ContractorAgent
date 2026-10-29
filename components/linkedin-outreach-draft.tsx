"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function LinkedinOutreachDraft({ body, fallback }: { body: string; fallback: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(body);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">LinkedIn message</h2>
          {fallback && <p className="mt-1 text-xs text-slate-500">No separate LinkedIn draft was saved for this older job; showing the email draft.</p>}
        </div>
        <button className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800" onClick={copy} type="button">
          {copied ? <Check aria-hidden="true" size={15} /> : <Copy aria-hidden="true" size={15} />}
          {copied ? "Copied" : "Copy message"}
        </button>
      </div>
      <textarea aria-label="LinkedIn message draft" className="mt-4 min-h-64 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-3 font-mono text-sm leading-6 text-slate-900" readOnly value={body} />
    </section>
  );
}
