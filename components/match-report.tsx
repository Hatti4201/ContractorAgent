import type { MatchReport } from "@/services/match-score";

const tones: Record<string, string> = {
  MET: "bg-emerald-50 text-emerald-800",
  OK: "bg-emerald-50 text-emerald-800",
  PARTIAL: "bg-amber-50 text-amber-900",
  UNKNOWN: "bg-slate-100 text-slate-700",
  MISSING: "bg-red-50 text-red-800",
  CONFLICT: "bg-red-50 text-red-800",
};

export function matchLabel(score: number | null) {
  return score === null ? "Match n/a" : `Match ${Math.round(score * 100)}%`;
}

/** Each requirement with its verdict and the line of the approved context that backs it. */
export function MatchReportSection({ report, threshold }: { report: MatchReport | null; threshold: number }) {
  return (
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" id="match">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-xl font-semibold text-slate-950">Match against your profile</h2>
        {report && (
          <p className={`rounded-full px-3 py-1 text-sm font-semibold ${report.score === null || report.score >= threshold ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
            {matchLabel(report.score)} · autopilot needs {Math.round(threshold * 100)}%
          </p>
        )}
      </div>
      {!report ? (
        <p className="mt-3 text-sm text-slate-600">The match could not be scored for this job.</p>
      ) : !report.requirements.length ? (
        <p className="mt-3 text-sm text-slate-600">The JD states no skills or eligibility requirements to score.</p>
      ) : (
        <ul className="mt-4 grid gap-2 text-sm md:grid-cols-2">
          {report.requirements.map((item, index) => (
            <li className="rounded-lg border border-slate-200 px-3 py-2" key={`${item.kind}-${index}`}>
              <p className="flex items-start justify-between gap-2">
                <span className="text-slate-900">{item.requirement}</span>
                <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs font-semibold ${tones[item.verdict] ?? tones.UNKNOWN}`}>{item.verdict}</span>
              </p>
              {item.evidence && <p className="mt-1 text-xs text-slate-500">“{item.evidence}”</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
