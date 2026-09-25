"use client";

import type { MouseEvent } from "react";

export type SwitchPosition = "OFF" | "DRAFT" | "SEND";

const positions: Array<{ value: SwitchPosition; label: string; hint: string }> = [
  { value: "OFF", label: "Off", hint: "Every job waits for your review." },
  { value: "DRAFT", label: "Drafts only", hint: "Jobs that pass become Outlook drafts; you send them." },
  { value: "SEND", label: "Send", hint: "Drafts go out on their own after the delay, within the daily limit." },
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
    const ok = window.confirm(`Turn on automatic sending?\n\nEach email that passes every check will be sent ${delayMinutes} minutes after its draft is built, up to ${limit} a day. You can cancel any one before it goes, or switch back at any time.`);
    if (!ok) event.preventDefault();
  }

  return (
    <div>
      <div aria-label="Autopilot" className="inline-flex rounded-xl border border-slate-300 bg-slate-100 p-1" role="radiogroup">
        {positions.map((position) => {
          const active = position.value === current;
          return (
            <form action={choose.bind(null, position.value)} key={position.value}>
              <button
                aria-checked={active}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                  active
                    ? position.value === "SEND" ? "bg-emerald-700 text-white shadow-sm" : "bg-white text-slate-950 shadow-sm"
                    : "text-slate-600 hover:text-slate-950"
                }`}
                disabled={active}
                onClick={position.value === "SEND" ? confirmSend : undefined}
                role="radio"
                type="submit"
              >
                {position.label}
              </button>
            </form>
          );
        })}
      </div>
      <p className="mt-2 text-sm text-slate-600">{positions.find((position) => position.value === current)!.hint}</p>
    </div>
  );
}
