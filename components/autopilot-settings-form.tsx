"use client";

import { Check, Clock, HelpCircle, Send, Target } from "lucide-react";
import { HoverLabel, labelScope } from "@/components/hover-label";
import { useState } from "react";

type SaveAction = (formData: FormData) => void | Promise<void>;

const inputClass = "w-20 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-right text-sm font-semibold outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";

export function AutopilotSettingsForm({
  action,
  employerAddress,
  threshold,
  startTime,
  endTime,
  dailyLimit,
  timeZone,
}: {
  action: SaveAction;
  employerAddress: string;
  threshold: number;
  startTime: string;
  endTime: string;
  dailyLimit: number;
  timeZone: string;
}) {
  const [dirty, setDirty] = useState(false);
  const initialValues = {
    employerCcAddress: employerAddress,
    threshold: String(Math.round(threshold * 100)),
    sendStartTime: startTime,
    sendEndTime: endTime,
    dailyLimit: String(dailyLimit),
  };

  function hasChanges(form: HTMLFormElement) {
    return Object.entries(initialValues).some(([name, value]) => String(new FormData(form).get(name) ?? "") !== value);
  }

  return (
    <form
      action={action}
      aria-label="Autopilot settings"
      className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
      onInput={(event) => setDirty(hasChanges(event.currentTarget))}
    >
      <label className={`relative min-w-64 flex-1 text-xs font-medium text-slate-500 ${labelScope.bar}`}>
        <span className="flex items-center gap-1 text-slate-700">Employer CC email <HelpCircle aria-hidden="true" size={12} /><HoverLabel scope="bar" text="Only copied on C2C outreach; never used for W2 or other messages." /></span>
        <input aria-label="Employer CC email" className={`${inputClass} mt-1 w-full text-left`} defaultValue={employerAddress} maxLength={320} name="employerCcAddress" placeholder="employer@example.com" type="email" />
      </label>

      <label className={`relative text-xs font-medium text-slate-500 ${labelScope.bar}`}>
        <span className="flex items-center gap-1 text-slate-700"><Target aria-hidden="true" size={13} />Minimum match <HelpCircle aria-hidden="true" size={12} /><HoverLabel scope="bar" text="Only jobs at or above this match score can continue automatically." /></span>
        <span className="mt-1 flex items-center gap-1 text-sm text-slate-700">
          <input aria-label="Match threshold, percent" className={inputClass} defaultValue={Math.round(threshold * 100)} max={100} min={0} name="threshold" required step={1} type="number" />%
        </span>
      </label>

      <label className={`relative text-xs font-medium text-slate-500 ${labelScope.bar}`}>
        <span className="flex items-center gap-1 text-slate-700"><Clock aria-hidden="true" size={13} />Automatic send window <HelpCircle aria-hidden="true" size={12} /><HoverLabel scope="bar" text={`Automatic sending is limited to ${timeZone} local time.`} /></span>
        <span className="mt-1 flex items-center gap-1 text-sm text-slate-700">
          <input aria-label="Automatic send start time" className={inputClass} defaultValue={startTime} name="sendStartTime" required step={900} type="time" />
          <span>to</span>
          <input aria-label="Automatic send end time" className={inputClass} defaultValue={endTime} name="sendEndTime" required step={900} type="time" />
        </span>
      </label>

      <label className={`relative text-xs font-medium text-slate-500 ${labelScope.bar}`}>
        <span className="flex items-center gap-1 text-slate-700"><Send aria-hidden="true" size={13} />Daily send limit <HelpCircle aria-hidden="true" size={12} /><HoverLabel scope="bar" text="Maximum messages sent across any rolling 24-hour period." /></span>
        <span className="mt-1 flex items-center gap-1 text-sm text-slate-700">
          <input aria-label="Daily send limit" className={inputClass} defaultValue={dailyLimit} max={500} min={0} name="dailyLimit" required step={1} type="number" />/24h
        </span>
      </label>

      <button
        aria-label="Save autopilot settings"
        className={`ml-auto flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${dirty ? "bg-emerald-700 text-white hover:bg-emerald-800" : "cursor-not-allowed bg-slate-200 text-slate-500"}`}
        disabled={!dirty}
        title={dirty ? "Save the changed settings" : "Change a setting to enable save"}
        type="submit"
      >
        <Check aria-hidden="true" size={15} />Save settings
      </button>
    </form>
  );
}
