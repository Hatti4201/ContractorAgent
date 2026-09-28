import { Check, CircleHelp, Minus, Target, X, type LucideIcon } from "lucide-react";
import type { MatchReport } from "@/services/match-score";

const verdicts: Record<string, { icon: LucideIcon; tone: string; tip: string }> = {
  MET: { icon: Check, tone: "bg-emerald-50 text-emerald-800", tip: "Met" },
  OK: { icon: Check, tone: "bg-emerald-50 text-emerald-800", tip: "OK" },
  PARTIAL: { icon: Minus, tone: "bg-amber-50 text-amber-900", tip: "Partly met" },
  UNKNOWN: { icon: CircleHelp, tone: "bg-slate-100 text-slate-700", tip: "Unknown" },
  MISSING: { icon: X, tone: "bg-red-50 text-red-800", tip: "Missing" },
  CONFLICT: { icon: X, tone: "bg-red-50 text-red-800", tip: "Conflict" },
};
/** Skill and eligibility verdicts share a colour, so the counts group by colour, not by word. */
const groups = [["MET", "OK"], ["PARTIAL"], ["UNKNOWN"], ["MISSING", "CONFLICT"]];

export function matchLabel(score: number | null) {
  return score === null ? "Match n/a" : `Match ${Math.round(score * 100)}%`;
}

/**
 * The score and a count per verdict; each requirement is a chip one click away, with the line of the
 * approved context that backs it in the tooltip.
 */
export function MatchReportSection({ report, threshold }: { report: MatchReport | null; threshold: number }) {
  const passes = report ? report.score === null || report.score >= threshold : false;
  const counts = groups
    .map((members) => ({ verdict: members[0]!, count: report?.requirements.filter((item) => members.includes(item.verdict)).length ?? 0 }))
    .filter((entry) => entry.count > 0);

  return (
    <details className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3" id="match">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 [&::-webkit-details-marker]:hidden" title={`Match against your profile; the autopilot needs ${Math.round(threshold * 100)}%`}>
        <Target aria-hidden="true" className="text-slate-500" size={16} />
        <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${!report ? "bg-slate-100 text-slate-600" : passes ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
          {report?.score != null ? `${Math.round(report.score * 100)}%` : "—"}
        </span>
        <span className="text-xs text-slate-400" title="Autopilot threshold">/ {Math.round(threshold * 100)}%</span>
        {counts.map(({ verdict, count }) => {
          const { icon: Icon, tone, tip } = verdicts[verdict]!;
          return (
            <span className={`flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`} key={verdict} title={tip}>
              <Icon aria-hidden="true" size={12} />{count}
            </span>
          );
        })}
      </summary>
      {!report ? (
        <p className="mt-2 text-sm text-slate-500">Not scored.</p>
      ) : !report.requirements.length ? (
        <p className="mt-2 text-sm text-slate-500">No requirements stated.</p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-1.5 text-sm">
          {report.requirements.map((item, index) => {
            const { icon: Icon, tone, tip } = verdicts[item.verdict] ?? verdicts.UNKNOWN!;
            return (
              <li className={`flex items-center gap-1 rounded-full px-2.5 py-1 ${tone}`} key={`${item.kind}-${index}`} title={item.evidence ? `${tip}: “${item.evidence}”` : tip}>
                <Icon aria-label={tip} size={13} />{item.requirement}
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
