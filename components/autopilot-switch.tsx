"use client";

import { FilePen, Pause, Send, type LucideIcon } from "lucide-react";
import type { MouseEvent } from "react";

export type SwitchPosition = "OFF" | "DRAFT" | "SEND";

const positions: Array<{ value: SwitchPosition; label: string; icon: LucideIcon; tip: string; on: string }> = [
  { value: "OFF", label: "Off", icon: Pause, tip: "Off: every job waits for your review", on: "bg-white text-slate-950" },
  { value: "DRAFT", label: "Drafts", icon: FilePen, tip: "Drafts only: jobs that pass become Outlook drafts; you send them", on: "bg-sky-600 text-white" },
  { value: "SEND", label: "Send", icon: Send, tip: "Send: drafts go out on their own after the delay, within the daily limit", on: "bg-emerald-700 text-white" },
];

/**
 * The autopilot's three positions. Moving to Send asks first, since from then on email leaves the
 * mailbox without a click.
 */
export function AutopilotSwitch({ current, choose, delayMinutes, limit }: {
  current: SwitchPosition;
  choose: (setting: string) => Promise<void>;
  delayMinutes: number;
  limit: number;
}) {
  function confirmSend(event: MouseEvent<HTMLButtonElement>) {
    const ok = window.confirm(`Turn on automatic sending?\n\nEach email that passes every check goes out ${delayMinutes} minutes after its draft is built, up to ${limit} a day. You can cancel any one before it goes.`);
    if (!ok) event.preventDefault();
  }

  return (
    <div aria-label="Autopilot" className="inline-flex rounded-xl border border-slate-300 bg-slate-100 p-1" role="radiogroup">
      {positions.map((position) => {
        const active = position.value === current;
        const Icon = position.icon;
        return (
          <form action={choose.bind(null, position.value)} key={position.value}>
            <button
              aria-checked={active}
              aria-label={position.tip}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${active ? `${position.on} shadow-sm` : "text-slate-500 hover:text-slate-950"}`}
              disabled={active}
              onClick={position.value === "SEND" ? confirmSend : undefined}
              role="radio"
              title={position.tip}
              type="submit"
            >
              <Icon aria-hidden="true" size={15} />
              {position.label}
            </button>
          </form>
        );
      })}
    </div>
  );
}
