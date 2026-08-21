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
