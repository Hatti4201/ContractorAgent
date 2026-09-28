import { Check, Clock, Send, ShieldCheck, Target } from "lucide-react";
import { saveAutopilotSettingsAction } from "@/app/(protected)/autopilot/actions";
import { AutopilotPanel, type AutopilotNotice } from "@/components/autopilot-panel";
import { requireAuth } from "@/lib/auth";
import { autopilotSettings } from "@/services/auto-send";

type Search = Record<string, string | string[] | undefined>;

// What stops a job whatever the threshold; listed so the user knows why a strong match still waits.
const alwaysChecked = [
  "Your application rules (W2 / C2C, Bay Area, local only, face to face)",
  "A recruiter email in the post",
  "A resume for the role family",
  "No eligibility conflict with your profile",
  "Not the same recruiter's job twice",
  "Nothing in the email your profile does not support",
];

const inputClass = "w-20 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-right text-sm font-semibold outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";

export default async function AutopilotPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAuth();
  const [query, settings] = await Promise.all([searchParams, autopilotSettings()]);
  const text = (key: string) => (typeof query[key] === "string" ? query[key] as string : undefined);
  const notice: AutopilotNotice = {
    autopilot: text("autopilot"),
    cancelled: text("cancelled"),
    autopilotRun: text("autopilotRun"),
    saved: text("saved"),
    invalid: text("invalid"),
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-6 py-8">
      <AutopilotPanel notice={notice} />

      <form action={saveAutopilotSettingsAction} aria-label="Autopilot settings" className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <label className="text-xs font-medium text-slate-500" title="Lowest match score the autopilot takes on; below it the job waits for you">
          <span className="flex items-center gap-1"><Target aria-hidden="true" size={13} />Match ≥</span>
          <span className="mt-1 flex items-center gap-1 text-sm text-slate-700">
            <input aria-label="Match threshold, percent" className={inputClass} defaultValue={Math.round(settings.threshold * 100)} max={100} min={0} name="threshold" required step={1} type="number" />%
          </span>
        </label>
        <label className="text-xs font-medium text-slate-500" title="Minutes between building the draft and sending it: the window to cancel in">
          <span className="flex items-center gap-1"><Clock aria-hidden="true" size={13} />Delay</span>
          <span className="mt-1 flex items-center gap-1 text-sm text-slate-700">
            <input aria-label="Send delay, minutes" className={inputClass} defaultValue={settings.delayMinutes} max={1440} min={1} name="delayMinutes" required step={1} type="number" />min
          </span>
        </label>
        <label className="text-xs font-medium text-slate-500" title="Emails sent automatically in any 24 hours; over it the best matches go and the rest stay as drafts">
          <span className="flex items-center gap-1"><Send aria-hidden="true" size={13} />Daily limit</span>
          <span className="mt-1 flex items-center gap-1 text-sm text-slate-700">
            <input aria-label="Daily send limit" className={inputClass} defaultValue={settings.dailyLimit} max={500} min={0} name="dailyLimit" required step={1} type="number" />/24h
          </span>
        </label>
        <button aria-label="Save, then run the autopilot on the waiting jobs" className="ml-auto flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800" title="Save; with the autopilot on, the waiting jobs are checked again" type="submit">
          <Check aria-hidden="true" size={15} />Save
        </button>
      </form>

      <details className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-slate-600 [&::-webkit-details-marker]:hidden" title="Checked on every job, whatever the match">
          <ShieldCheck aria-hidden="true" className="text-emerald-600" size={16} />{alwaysChecked.length}
        </summary>
        <ul className="mt-2 space-y-1 text-sm text-slate-700">
          {alwaysChecked.map((item) => <li className="flex items-center gap-2" key={item}><Check aria-hidden="true" className="shrink-0 text-emerald-600" size={14} />{item}</li>)}
        </ul>
      </details>
    </div>
  );
}
