"use client";

import { useFormStatus } from "react-dom";

export function GenerateOutreachButton() {
  const { pending } = useFormStatus();
  return <button aria-disabled={pending} className="rounded-lg bg-emerald-700 px-4 py-2.5 font-medium text-white hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-60" disabled={pending} type="submit">{pending ? "Generating preview…" : "Generate validated preview"}</button>;
}
