import { Check, ShieldCheck } from "lucide-react";
import { saveAutopilotSettingsAction } from "@/app/(protected)/autopilot/actions";
import { AutopilotPanel, type AutopilotNotice } from "@/components/autopilot-panel";
import { AutopilotSettingsForm } from "@/components/autopilot-settings-form";
import { requireAuth } from "@/lib/auth";
import { autopilotSettings } from "@/services/auto-send";
import { currentEmployerCcSetting } from "@/services/employer";

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

export default async function AutopilotPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAuth();
  const [query, settings, employer] = await Promise.all([searchParams, autopilotSettings(), currentEmployerCcSetting()]);
  const text = (key: string) => (typeof query[key] === "string" ? query[key] as string : undefined);
  const notice: AutopilotNotice = {
    autopilot: text("autopilot"),
    cancelled: text("cancelled"),
    autopilotRun: text("autopilotRun"),
    draftSend: text("draftSend"),
    saved: text("saved"),
    invalid: text("invalid"),
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-6 py-8">
      <AutopilotPanel notice={notice} />

      <AutopilotSettingsForm
        action={saveAutopilotSettingsAction}
        dailyLimit={settings.dailyLimit}
        employerAddress={employer.address ?? ""}
        endTime={settings.endTime}
        startTime={settings.startTime}
        threshold={settings.threshold}
        timeZone={process.env.APP_TIME_ZONE?.trim() || "UTC"}
      />

      <details className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-slate-600 [&::-webkit-details-marker]:hidden" title="Checked on every job, whatever the match">
          <ShieldCheck aria-hidden="true" className="text-emerald-600" size={16} />Always checked · {alwaysChecked.length} rules
        </summary>
        <ul className="mt-2 space-y-1 text-sm text-slate-700">
          {alwaysChecked.map((item) => <li className="flex items-center gap-2" key={item}><Check aria-hidden="true" className="shrink-0 text-emerald-600" size={14} />{item}</li>)}
        </ul>
      </details>
    </div>
  );
}
