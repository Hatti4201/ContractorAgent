"use client";

export function DeleteJobForm({ action }: { action: () => Promise<void> }) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm("Delete this job and its complete timeline? This cannot be undone.")) {
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
      <button className="text-sm font-medium text-red-700 underline hover:text-red-900" type="submit">Delete</button>
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
        className="rounded-full px-1.5 py-0.5 text-sm font-semibold leading-none text-red-700 opacity-0 hover:bg-red-50 focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100"
        type="submit"
      >
        ✕
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
