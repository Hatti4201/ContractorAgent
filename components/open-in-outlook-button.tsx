"use client";

import { useRouter } from "next/navigation";
import { useState, type MouseEvent } from "react";

/**
 * Opens the tab inside the click itself, before anything is awaited. A tab opened this way is one
 * the browser lets Outlook close again when the message is sent, which is what returns the user
 * here; a tab opened after an await is blocked, and a plain redirect leaves nothing to come back to.
 */
export function OpenInOutlookButton({
  action,
  children,
}: {
  action: (formData: FormData) => Promise<{ url: string | null; href?: string | null }>;
  children: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run(event: MouseEvent<HTMLButtonElement>) {
    // type="button" skips the browser's own check, so ask for it where there is a form to check:
    // a reply still needs its thread. Standing alone, the button carries no fields of its own.
    const form = event.currentTarget.form;
    if (form && !form.reportValidity()) return;
    const tab = window.open("", "_blank");
    setBusy(true);
    try {
      const { url, href } = await action(form ? new FormData(form) : new FormData());
      // replace, not assign: the blank placeholder leaves no history entry behind, so the tab holds
      // a single page -- the state a browser is willing to let Outlook close again after Send.
      if (url && tab) tab.location.replace(url);
      else tab?.close();
      // The review screen sends the user on to the job; the job page is already where it belongs.
      if (href) router.push(href);
      else router.refresh();
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
