import Link from "next/link";
import { IntakeForm } from "@/components/intake-form";

export default function IntakePage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <Link className="text-sm font-medium text-emerald-700 underline" href="/jobs">← All jobs</Link>
      <p className="mt-4 text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">AI intake</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Paste, analyze, then review</h1>
      <p className="mt-2 text-slate-600">Unknown facts stay unknown. The analyzer cannot create or change an opportunity until you confirm.</p>
      <div className="mt-8"><IntakeForm /></div>
    </div>
  );
}
