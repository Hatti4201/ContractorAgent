import Link from "next/link";
import { discardIntake } from "@/app/(protected)/intake/actions";
import { DiscardIntakeForm } from "@/components/delete-job-form";
import { IntakeForm } from "@/components/intake-form";
import { requireAuth } from "@/lib/auth";
import { formatDateTime, formatEnum } from "@/lib/job-values";
import { queuedIntakes } from "@/services/intake-queue";

const state: Record<string, { label: string; tone: string }> = {
  ANALYZING: { label: "Preparing", tone: "bg-slate-100 text-slate-700" },
  READY: { label: "Ready to review", tone: "bg-emerald-50 text-emerald-800" },
  STOPPED: { label: "Needs your input", tone: "bg-amber-50 text-amber-900" },
  FAILED: { label: "Interrupted", tone: "bg-red-50 text-red-800" },
};

export default async function IntakePage({ searchParams }: { searchParams: Promise<{ discarded?: string; error?: string }> }) {
  await requireAuth();
  const [{ discarded, error }, queue] = await Promise.all([searchParams, queuedIntakes()]);

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <Link className="text-sm font-medium text-emerald-700 underline" href="/jobs">← All jobs</Link>
      <p className="mt-4 text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Add job</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Add job</h1>
      <p className="mt-2 text-slate-600">Paste the source and everything else is prepared for one review. Unknown facts stay unknown, and nothing becomes an opportunity until you confirm. You can also <Link className="font-medium text-emerald-700 underline" href="/jobs/new">enter a job manually</Link>.</p>

      {discarded && <p className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-900" role="status">Pasted source discarded.</p>}
      {error && <p className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800" role="alert">That source is no longer waiting for review.</p>}

      {queue.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xl font-semibold text-slate-950">Waiting for your review</h2>
          <p className="mt-1 text-sm text-slate-600">Analyzed sources that have not become opportunities yet. They stay here until you confirm or discard them.</p>
          <ul className="mt-5 space-y-3">
            {queue.map((intake) => (
              <li className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" key={intake.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link className="font-semibold text-slate-950 underline" href={`/intakes/${intake.id}/review`}>{intake.title}</Link>
                    <p className="mt-1 text-sm text-slate-600">{formatEnum(intake.sourceType)} · {formatDateTime(intake.createdAt)} UTC</p>
                    {intake.detail && <p className="mt-2 text-sm text-amber-900">{intake.detail}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${state[intake.state]!.tone}`}>{state[intake.state]!.label}</span>
                    <DiscardIntakeForm action={discardIntake.bind(null, intake.id)} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-8"><IntakeForm /></div>
    </div>
  );
}
