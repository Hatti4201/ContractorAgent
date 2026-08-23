import Link from "next/link";
import { IntakeForm } from "@/components/intake-form";

export default function IntakePage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <Link className="text-sm font-medium text-emerald-700 underline" href="/jobs">← All jobs</Link>
      <p className="mt-4 text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Add job</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Add job</h1>
      <p className="mt-2 text-slate-600">Paste the source and everything else is prepared for one review. Unknown facts stay unknown, and nothing becomes an opportunity until you confirm. You can also <Link className="font-medium text-emerald-700 underline" href="/jobs/new">enter a job manually</Link>.</p>
      <div className="mt-8"><IntakeForm /></div>
    </div>
  );
}
