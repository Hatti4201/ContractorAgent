import { runExposureNow } from "@/app/(protected)/exposure/actions";
import { ExposureResult } from "@/app/generated/prisma/enums";
import { requireAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/job-values";
import { getPrisma } from "@/lib/prisma";
import { exposureConfigFromEnv } from "@/services/exposure-rules";
import { exposureRunning, exposureState, recentCounts } from "@/services/exposure-run";

type Answer = { question: string; kind: string; answer: string; factQuote: string | null };

const resultStyle: Record<ExposureResult, string> = {
  APPLIED: "bg-emerald-50 text-emerald-800",
  DRY_RUN_READY: "bg-sky-50 text-sky-800",
  SKIPPED: "bg-slate-100 text-slate-600",
  FAILED: "bg-red-50 text-red-800",
};

const modeLabel = { off: "Off", dryrun: "Dry run (stops before Submit)", on: "On (submits applications)" };

export default async function ExposurePage() {
  await requireAuth();
  const config = exposureConfigFromEnv();
  const database = getPrisma();
  const [state, count, records] = await Promise.all([
    exposureState(),
    recentCounts(),
    database.exposureApplication.findMany({ orderBy: { createdAt: "desc" }, take: 80 }),
  ]);
  const running = exposureRunning();
  const { days, startHour, endHour, intervalMs, timeZone } = config.window;

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Exposure</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Dice exposure</h1>
      <p className="mt-2 text-slate-600">Applies to today&apos;s &ldquo;{config.keyword}&rdquo; contract jobs so recruiters see the profile. Rules: rules/exposure.md.</p>

      {state.consecutiveFailures > 0 && (
        <p className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-900" role="alert">
          The last {state.consecutiveFailures === 1 ? "run" : `${state.consecutiveFailures} runs`} stopped: {state.lastError ?? "reason unknown"}
        </p>
      )}

      <section className="mt-8 grid gap-4 rounded-2xl border border-slate-200 bg-white p-6 text-sm shadow-sm sm:grid-cols-4">
        <div><p className="text-slate-500">Mode</p><p className="mt-1 font-semibold text-slate-950">{modeLabel[config.mode]}</p></div>
        <div><p className="text-slate-500">Schedule</p><p className="mt-1 font-semibold text-slate-950">Days {days.join(",")} · {startHour}:00–{endHour}:00 · every {intervalMs / 60_000} min · {timeZone}</p></div>
        <div><p className="text-slate-500">Last run</p><p className="mt-1 font-semibold text-slate-950">{running ? "Running now" : state.lastRunAt ? formatDateTime(state.lastRunAt) : "Never"}</p></div>
        <div><p className="text-slate-500">Last 24 hours</p><p className="mt-1 font-semibold text-slate-950">{count(ExposureResult.APPLIED)} applied · {count(ExposureResult.DRY_RUN_READY)} rehearsed · {count(ExposureResult.SKIPPED)} skipped · {count(ExposureResult.FAILED)} failed · limit {config.dailyLimit}</p></div>
        <form action={runExposureNow} className="sm:col-span-4">
          <button className="rounded-lg bg-blue-700 px-4 py-2.5 font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300" disabled={config.mode === "off" || running} type="submit">Run now</button>
          {config.mode === "off" && <span className="ml-3 text-slate-500">Set EXPOSURE_MODE to dryrun or on to enable.</span>}
        </form>
      </section>

      <section className="mt-8">
        <h2 className="text-2xl font-semibold text-slate-950">Recent jobs</h2>
        {records.length ? (
          <ol className="mt-4 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white shadow-sm">
            {records.map((row) => {
              const answers = (row.answers ?? []) as Answer[];
              return (
                <li className="p-4 text-sm" key={row.id}>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${resultStyle[row.result]}`}>{row.result.replaceAll("_", " ").toLowerCase()}</span>
                    <a className="font-medium text-slate-950 underline" href={row.url} rel="noopener noreferrer" target="_blank">{row.title}</a>
                    {row.company && <span className="text-slate-500">{row.company}</span>}
                    <span className="ml-auto text-slate-500">{formatDateTime(row.createdAt)}</span>
                  </div>
                  {row.reason && <p className="mt-1 text-slate-600">{row.reason}</p>}
                  {answers.length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-slate-600">{answers.length} answer{answers.length === 1 ? "" : "s"}{answers.some((answer) => answer.kind === "identity") ? " · includes identity" : ""}</summary>
                      <ul className="mt-2 grid gap-1 text-slate-700">
                        {answers.map((answer, index) => (
                          <li key={index}><span className="font-medium">{answer.kind}</span> · {answer.question} → {answer.answer}{answer.factQuote ? ` (from: “${answer.factQuote}”)` : ""}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              );
            })}
          </ol>
        ) : <p className="mt-4 text-slate-600">No jobs yet.</p>}
      </section>
    </div>
  );
}
