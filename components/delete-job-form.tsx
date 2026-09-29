"use client";

import { Trash2 } from "lucide-react";
import { HoverLabel, labelScope } from "@/components/hover-label";

const deleteWarning = (title: string) =>
  `Delete “${title}”?\n\nIts timeline goes, its email is not sent, and its unsent Outlook draft is deleted too. The same JD from the same recruiter will not come back in. This cannot be undone.`;

/**
 * The job's delete as an icon. "corner" sits over a card and shows on hover, focus, or a touch screen,
 * like the queue's ✕; "inline" stands in a page header.
 */
export function DeleteJobIcon({ action, title, placement = "inline" }: { action: () => Promise<void>; title: string; placement?: "inline" | "corner" }) {
  return (
    <form action={action} className={placement === "corner" ? "absolute right-1 top-1/2 -translate-y-1/2" : labelScope.bar} onSubmit={(event) => {
      if (!window.confirm(deleteWarning(title))) event.preventDefault();
    }}>
      <button
        aria-label={`Delete ${title}`}
        className={placement === "corner"
          ? "relative rounded-md bg-white p-1 text-red-600 opacity-0 hover:bg-red-50 focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100"
          : "relative rounded-lg border border-red-200 bg-white p-2 text-red-600 hover:border-red-400 hover:bg-red-50"}
        type="submit"
      >
        <Trash2 aria-hidden="true" size={placement === "corner" ? 14 : 17} />
        <HoverLabel scope={placement === "corner" ? "row" : "bar"} text="删除" />
      </button>
    </form>
  );
}

export function DeleteJobForm({ action }: { action: () => Promise<void> }) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(deleteWarning("this job"))) {
          event.preventDefault();
        }
      }}
    >
      <button className="text-sm font-medium text-red-700 underline hover:text-red-900" type="submit">
        Delete job
      </button>
    </form>
  );
}

export function DeleteResumeForm({ action }: { action: () => Promise<void> }) {
  return (
    <form action={action} onSubmit={(event) => {
      if (!window.confirm("Delete this resume registry entry? The local file will not be deleted.")) event.preventDefault();
    }}>
      <button className="w-full rounded px-3 py-2 text-left text-sm font-medium text-red-600 hover:bg-red-50" type="submit">Delete</button>
    </form>
  );
}

export function DeleteRecruiterForm({ action }: { action: () => Promise<void> }) {
  return (
    <form action={action} onSubmit={(event) => {
      if (!window.confirm("Delete this recruiter? Their contact details cannot be recovered.")) event.preventDefault();
    }}>
      <button className="text-sm font-medium text-red-700 underline hover:text-red-900" type="submit">Delete recruiter</button>
    </form>
  );
}

/** Sits over a card, so it stays out of sight until the card is hovered, focused, or on a touch screen. */
export function DiscardIntakeCross({ action, title }: { action: () => Promise<void>; title: string }) {
  return (
    <form action={action} className="absolute right-1 top-1" onSubmit={(event) => {
      if (!window.confirm(`Discard “${title}”? The analysis already paid for cannot be recovered.`)) event.preventDefault();
    }}>
      <button
        aria-label={`Discard ${title}`}
        className="relative rounded-full px-1.5 py-0.5 text-sm font-semibold leading-none text-red-700 opacity-0 hover:bg-red-50 focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100"
        type="submit"
      >
        ✕
        <HoverLabel scope="row" text="丢弃" />
      </button>
    </form>
  );
}

export function DiscardIntakeForm({ action }: { action: () => Promise<void> }) {
  return (
    <form action={action} onSubmit={(event) => {
      if (!window.confirm("Discard this pasted source? The analysis already paid for cannot be recovered.")) event.preventDefault();
    }}>
      <button className="text-sm font-medium text-red-700 underline hover:text-red-900" type="submit">Discard</button>
    </form>
  );
}
