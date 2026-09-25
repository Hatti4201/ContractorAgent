"use client";

import { useState } from "react";

/** Grey text that turns into a small form when clicked; Cancel puts the text back untouched. */
export function InlineDescription({ action, value }: { action: (formData: FormData) => void | Promise<void>; value: string }) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <button className="mt-1 block w-full rounded text-left text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-700" onClick={() => setEditing(true)} title="Click to edit what separates this family" type="button">
        {value}
      </button>
    );
  }
  return (
    <form action={action} className="mt-2">
      <textarea autoFocus className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" defaultValue={value} maxLength={500} name="description" required rows={3} />
      <div className="mt-2 flex gap-3 text-sm">
        <button className="rounded-lg bg-slate-950 px-3 py-1.5 font-medium text-white hover:bg-slate-800" type="submit">Save</button>
        <button className="font-medium text-slate-600 underline" onClick={() => setEditing(false)} type="button">Cancel</button>
      </div>
    </form>
  );
}
