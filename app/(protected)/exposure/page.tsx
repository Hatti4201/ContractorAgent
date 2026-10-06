import Link from "next/link";
import { dismissExposureError, saveExposureSettings, setExposureMode, setExposureSchedule } from "@/app/(protected)/exposure/actions";
import { ExposurePlayButton } from "@/components/exposure-play-button";
import { ExposureResult } from "@/app/generated/prisma/enums";
import { AutoRefresh } from "@/components/auto-refresh";
import { ExposureChart } from "@/components/exposure-chart";
import { requireAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/job-values";
import { getPrisma } from "@/lib/prisma";
import { chromeReachable } from "@/services/cdp";
import { employmentTypes, pagesToVisit, type ExposureMode } from "@/services/exposure-rules";
import { exposureRunning, exposureState, loadExposureConfig, recentCounts, weekOfResults } from "@/services/exposure-run";

type Answer = { question: string; kind: string; answer: string; factQuote: string | null };

const resultOrder: ExposureResult[] = [ExposureResult.APPLIED, ExposureResult.DRY_RUN_READY, ExposureResult.FAILED, ExposureResult.SKIPPED];
const resultStyle: Record<ExposureResult, string> = {
  APPLIED: "bg-emerald-50 text-emerald-800",
  DRY_RUN_READY: "bg-sky-50 text-sky-800",
  SKIPPED: "bg-slate-100 text-slate-600",
  FAILED: "bg-red-50 text-red-800",
};
const resultLabel: Record<ExposureResult, string> = { APPLIED: "Applied", DRY_RUN_READY: "Dry run", FAILED: "Failed", SKIPPED: "Skipped" };
const modeShort: Record<ExposureMode, string> = { off: "Off", dryrun: "Dry run", on: "Live" };
const modeTone: Record<ExposureMode, string> = { off: "bg-slate-100 text-slate-600", dryrun: "bg-sky-100 text-sky-800", on: "bg-emerald-100 text-emerald-800" };
const modeLabel: Record<ExposureMode, string> = { off: "Off", dryrun: "Dry run — stops before Submit", on: "On — submits applications" };
const employmentLabel: Record<string, string> = { CONTRACTS: "Contract", THIRD_PARTY: "Third Party", FULLTIME: "Full-time", PARTTIME: "Part-time" };
const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";

function NumberField({ label, name, value, min, max, hint }: { label: string; name: string; value: number; min: number; max: number; hint?: string }) {
  return (
    <label className="text-sm text-slate-700">
      <span className="font-medium">{label}</span>
      <input className={field} defaultValue={value} max={max} min={min} name={name} type="number" />
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export default async function ExposurePage({ searchParams }: { searchParams: Promise<{ notice?: string; result?: string }> }) {
  await requireAuth();
  const { notice, result } = await searchParams;
  const database = getPrisma();
  const config = await loadExposureConfig(database);
  const filter = resultOrder.find((value) => value === result);
  const [state, count, records, week, chrome] = await Promise.all([
    exposureState(database),
    recentCounts(database),
    database.exposureApplication.findMany({ where: filter ? { result: filter } : {}, orderBy: { createdAt: "desc" }, take: 80 }),
    weekOfResults(database),
    chromeReachable(config.cdpUrl),
  ]);
  const running = exposureRunning(state);
  const errorAt = state.lastErrorAt ?? state.updatedAt;
  const errorVisible = state.consecutiveFailures > 0 && Boolean(state.lastError) && (!state.errorClearedAt || errorAt > state.errorClearedAt);
  const counted = count(ExposureResult.APPLIED) + count(ExposureResult.DRY_RUN_READY);
  const stopReason = state.lastStopReason ?? (counted >= config.dailyLimit
    ? `Daily limit reached (${counted}/${config.dailyLimit}). The limit resets daily at 5:00 AM local time; the next run will continue after the reset.`
    : null);
  const blockedReason = config.mode === "off" ? "Mode is Off: choose Dry run or Live below" : !chrome ? "Dedicated Chrome not running: npm run exposure:chrome" : null;
  const exampleTotal = 10;

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <AutoRefresh active={running} />
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Exposure</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Dice exposure</h1>
      <p className="mt-2 text-slate-600">Applies to Dice Easy Apply jobs so recruiters see the profile. Rules: rules/exposure.md.</p>

      {notice === "saved" && <p className="mt-6 rounded-xl bg-emerald-50 p-4 text-sm font-medium text-emerald-900">Saved. Takes effect from the next run.</p>}
      {notice === "confirm-on" && <p className="mt-6 rounded-xl bg-amber-50 p-4 text-sm font-medium text-amber-900">Tick the confirmation box to switch on real submissions.</p>}
      {errorVisible && (
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900" role="alert">
          <div className="min-w-0 flex-1">
            <p className="font-semibold">The last {state.consecutiveFailures === 1 ? "run" : `${state.consecutiveFailures} runs`} stopped</p>
            <p className="mt-1">{state.lastError}</p>
            <p className="mt-2 text-xs text-red-800">发生时间：{formatDateTime(errorAt)}</p>
          </div>
          <form action={dismissExposureError}>
            <button aria-label="Dismiss Dice exposure error" className="rounded-lg p-1 text-red-700 hover:bg-red-100" title="Dismiss this error" type="submit">×</button>
          </form>
        </div>
      )}
      {!running && stopReason && (
        <div className="mt-6 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950" role="status">
          <p className="font-semibold">上次暂停原因</p>
          <p className="mt-1">{stopReason}</p>
          {state.lastStopAt && <p className="mt-2 text-xs text-sky-800">发生时间：{formatDateTime(state.lastStopAt)}</p>}
        </div>
      )}

      {/* Status and controls */}
      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <ExposurePlayButton blockedReason={blockedReason} running={running} stopping={state.stopRequested} />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${modeTone[config.mode]}`} title="Mode">{modeShort[config.mode]}</span>
              <span className="inline-flex items-center gap-1.5 text-slate-700" title={chrome ? "Dedicated Chrome connected" : "Dedicated Chrome not running: npm run exposure:chrome"}>
                <span aria-hidden className={`h-2 w-2 rounded-full ${chrome ? "bg-emerald-500" : "bg-red-500"}`} />Chrome
              </span>
              <span className="inline-flex items-center gap-1.5 text-slate-700" title="Applied or dry-run since 5:00 AM local time, of the daily limit">
                <svg aria-hidden className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" strokeLinecap="round" /></svg>
                {counted} / {config.dailyLimit}
              </span>
              <span className="inline-flex items-center gap-1.5 text-slate-700" title="Last run">
                <svg aria-hidden className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                {state.lastRunAt ? formatDateTime(state.lastRunAt) : "Never"}
              </span>
              {/* The schedule switch: a clock that is dark when the hourly runs are on, grey and struck through when paused. */}
              <form action={setExposureSchedule.bind(null, !config.scheduleEnabled)}>
                <button
                  aria-label={config.scheduleEnabled ? "Hourly runs on: pause them" : "Hourly runs paused: turn them on"}
                  aria-pressed={config.scheduleEnabled}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${config.scheduleEnabled ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-white text-slate-400 line-through"}`}
                  title={config.scheduleEnabled ? `Hourly runs on (${config.startHour}:00–${config.endHour}:00). Click to pause them.` : "Hourly runs paused. Click to turn them on."}
                  type="submit"
                >
                  <svg aria-hidden className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" strokeLinecap="round" /></svg>
                  {config.startHour}–{config.endHour}
                </button>
              </form>
            </div>
            {running && <p aria-live="polite" className="mt-2 truncate text-sm text-sky-900">{state.stopRequested ? "Stopping after this step · " : ""}{state.progress ?? "Starting"}</p>}
          </div>
        </div>

        <form action={setExposureMode} className="mt-6 border-t border-slate-100 pt-5">
          <fieldset className="flex flex-wrap items-center gap-4 text-sm">
            <legend className="mb-2 font-medium text-slate-950">Mode</legend>
            {(["off", "dryrun", "on"] as const).map((mode) => (
              <label className="inline-flex items-center gap-2" key={mode}>
                <input defaultChecked={config.mode === mode} name="mode" type="radio" value={mode} />
                {modeLabel[mode]}
              </label>
            ))}
          </fieldset>
          <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
            <input name="confirmOn" type="checkbox" value="yes" />
            I understand &ldquo;On&rdquo; submits real applications on Dice (required only to switch it on)
          </label>
          <button className="mt-3 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:border-slate-500" type="submit">Save mode</button>
        </form>
      </section>

      {/* Chart */}
      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-950">Results over time</h2>
        <div className="mt-4"><ExposureChart events={week.events} now={week.now} timeZone={config.window.timeZone} /></div>
      </section>

      {/* Settings */}
      <form action={saveExposureSettings} className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-950">Settings</h2>
        <p className="mt-1 text-sm text-slate-500">Saved settings take effect from the next run. Easy Apply only, truthful identity answers and the login / human-check stop are fixed by the rules.</p>

        <h3 className="mt-6 font-semibold text-slate-950">What to search</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className="text-sm text-slate-700">
            <span className="font-medium">Keywords</span>
            <input className={field} defaultValue={config.keywords.join(", ")} name="keywords" />
            <span className="mt-1 block text-xs text-slate-500">Comma-separated; each keyword is its own search.</span>
          </label>
          <label className="text-sm text-slate-700">
            <span className="font-medium">Posted</span>
            <select className={field} defaultValue={config.postedDate} name="postedDate">
              <option value="ONE">Today</option>
              <option value="THREE">Last 3 days</option>
              <option value="SEVEN">Last 7 days</option>
            </select>
          </label>
          <fieldset className="text-sm text-slate-700">
            <legend className="font-medium">Employment type</legend>
            <div className="mt-2 flex flex-wrap gap-4">
              {employmentTypes.map((type) => (
                <label className="inline-flex items-center gap-2" key={type}>
                  <input defaultChecked={config.employmentTypes.includes(type)} name="employmentTypes" type="checkbox" value={type} />
                  {employmentLabel[type]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-4">
            <NumberField hint={`e.g. ${exampleTotal} result pages → ${pagesToVisit(exampleTotal, config.pageRatio, config.maxPages)} visited`} label="Share of pages (%)" max={100} min={5} name="pagePercent" value={Math.round(config.pageRatio * 100)} />
            <NumberField label="Max pages" max={50} min={1} name="maxPages" value={config.maxPages} />
          </div>
        </div>

        <h3 className="mt-6 font-semibold text-slate-950">What to skip</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className="text-sm text-slate-700">
            <span className="font-medium">Title blacklist</span>
            <input className={field} defaultValue={config.titleBlacklist.join(", ")} name="titleBlacklist" />
            <span className="mt-1 block text-xs text-slate-500">Matches at a word start: &ldquo;Test&rdquo; also skips &ldquo;Tester&rdquo;.</span>
          </label>
          <label className="text-sm text-slate-700">
            <span className="font-medium">Company blacklist</span>
            <input className={field} defaultValue={config.companyBlacklist.join(", ")} name="companyBlacklist" />
          </label>
        </div>

        <h3 className="mt-6 font-semibold text-slate-950">How many, how fast</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <NumberField hint="Resets daily at 5:00 AM local time" label="Daily limit" max={1000} min={1} name="dailyLimit" value={config.dailyLimit} />
          <NumberField hint="Spreads the day across runs" label="Per-run limit" max={1000} min={1} name="perRunLimit" value={config.perRunLimit} />
          <NumberField label="Seconds between applications" max={600} min={0} name="jobDelaySeconds" value={config.jobDelaySeconds} />
        </div>

        <h3 className="mt-6 font-semibold text-slate-950">When to run ({config.window.timeZone})</h3>
        <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-700">
          {dayLabels.map((day, index) => (
            <label className="inline-flex items-center gap-2" key={day}>
              <input defaultChecked={config.days.includes(index)} name="days" type="checkbox" value={index} />
              {day}
            </label>
          ))}
        </div>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <NumberField label="Start hour (0–23)" max={23} min={0} name="startHour" value={config.startHour} />
          <NumberField label="End hour (1–24)" max={24} min={1} name="endHour" value={config.endHour} />
          <NumberField label="Minutes between runs" max={1440} min={5} name="intervalMinutes" value={config.intervalMinutes} />
        </div>

        <details className="mt-6">
          <summary className="cursor-pointer font-semibold text-slate-950">Advanced</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <NumberField label="Stop after failures in a row" max={50} min={1} name="maxConsecutiveFailures" value={config.maxConsecutiveFailures} />
            <NumberField label="Max steps per application" max={40} min={3} name="maxStepsPerJob" value={config.maxStepsPerJob} />
            <label className="text-sm text-slate-700"><span className="font-medium">Executor model</span><input className={field} defaultValue={config.executorModel} name="executorModel" /></label>
            <label className="text-sm text-slate-700"><span className="font-medium">Supervisor model</span><input className={field} defaultValue={config.supervisorModel} name="supervisorModel" /></label>
          </div>
        </details>

        <button className="mt-6 rounded-lg bg-slate-950 px-4 py-2.5 font-medium text-white hover:bg-slate-800" type="submit">Save settings</button>
      </form>

      {/* Records */}
      <section className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-2xl font-semibold text-slate-950">Recent jobs</h2>
          <nav aria-label="Filter by result" className="flex flex-wrap gap-2 text-sm">
            <Link className={`rounded-full px-3 py-1 ${!filter ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700"}`} href="/exposure">All</Link>
            {resultOrder.map((value) => (
              <Link className={`rounded-full px-3 py-1 ${filter === value ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700"}`} href={`/exposure?result=${value}`} key={value}>{resultLabel[value]}</Link>
            ))}
          </nav>
        </div>
        {records.length ? (
          <ol className="mt-4 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white shadow-sm">
            {records.map((row) => {
              const answers = (row.answers ?? []) as Answer[];
              const identity = answers.filter((answer) => answer.kind === "identity");
              return (
                <li className="p-4 text-sm" key={row.id}>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${resultStyle[row.result]}`}>{resultLabel[row.result]}</span>
                    <a className="font-medium text-slate-950 underline" href={row.url} rel="noopener noreferrer" target="_blank">{row.title}</a>
                    {row.company && <span className="text-slate-500">{row.company}</span>}
                    <span className="ml-auto text-slate-500">{formatDateTime(row.createdAt)}</span>
                  </div>
                  {row.reason && <p className="mt-1 text-slate-600">{row.reason}</p>}
                  {identity.length > 0 && (
                    <ul className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-950">
                      {identity.map((answer, index) => <li key={index}><span className="font-semibold">Identity</span> · {answer.question} → {answer.answer}{answer.factQuote ? ` (from: “${answer.factQuote}”)` : ""}</li>)}
                    </ul>
                  )}
                  {answers.length > identity.length && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-slate-600">{answers.length - identity.length} other answer{answers.length - identity.length === 1 ? "" : "s"}</summary>
                      <ul className="mt-2 grid gap-1 text-slate-700">
                        {answers.filter((answer) => answer.kind !== "identity").map((answer, index) => (
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
