"use client";

import { useRouter } from "next/navigation";
import { useState, type MouseEvent } from "react";

/**
 * Opens the tab inside the click itself, before anything is awaited. A tab opened this way is one
 * the browser lets Outlook close again when the message is sent, which is what returns the user
 * here; a tab opened after an await is blocked, and a plain redirect leaves nothing to come back to.
 */
export function ConfirmAndDraftButton({
  action,
  children,
}: {
  action: (formData: FormData) => Promise<{ jobId: string; url: string | null }>;
  children: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run(event: MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;
    // type="button" skips the browser's own check, so ask for it: a reply still needs its thread.
    if (!form || !form.reportValidity()) return;
    const tab = window.open("", "_blank");
    setBusy(true);
    try {
      const { jobId, url } = await action(new FormData(form));
      if (url && tab) tab.location.href = url;
      else tab?.close();
      router.push(`/jobs/${jobId}/outreach`);
    } catch {
      tab?.close();
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <button
      className="rounded-lg bg-emerald-700 px-5 py-3 font-medium text-white hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-60"
      disabled={busy}
      onClick={run}
      type="button"
    >
      {busy ? "Creating the draft…" : children}
    </button>
  );
}
