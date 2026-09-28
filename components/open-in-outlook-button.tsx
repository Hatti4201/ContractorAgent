"use client";

import { Loader } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type MouseEvent, type ReactNode } from "react";

/**
 * Opens the tab inside the click itself, before anything is awaited. A tab opened this way is one
 * the browser lets Outlook close again when the message is sent, which is what returns the user
 * here; a tab opened after an await is blocked, and a plain redirect leaves nothing to come back to.
 */
export function OpenInOutlookButton({
  action,
  children,
  open = true,
  tone = "primary",
  icon,
  title,
}: {
  action: (formData: FormData) => Promise<{ url: string | null; href?: string | null }>;
  children: string;
  /** False builds the draft and leaves it in Outlook, for a batch the user opens later in one trip. */
  open?: boolean;
  tone?: "primary" | "secondary";
  /** Rendered before the label; a server page passes an element, since a component cannot cross over. */
  icon?: ReactNode;
  /** The full meaning, for the tooltip and screen readers, when the visible label is a word or two. */
  title?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run(event: MouseEvent<HTMLButtonElement>) {
    // type="button" skips the browser's own check, so ask for it where there is a form to check:
    // a reply still needs its thread. Standing alone, the button carries no fields of its own.
    const form = event.currentTarget.form;
    if (form && !form.reportValidity()) return;
    const tab = open ? window.open("", "_blank") : null;
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
      aria-label={title}
      className={`flex items-center gap-2 rounded-lg px-5 py-3 font-medium disabled:cursor-wait disabled:opacity-60 ${tone === "primary" ? "bg-emerald-700 text-white hover:bg-emerald-800" : "border border-slate-400 bg-white text-slate-800 hover:border-slate-600"}`}
      disabled={busy}
      onClick={run}
      title={title}
      type="button"
    >
      {busy ? <Loader aria-hidden="true" className="animate-spin" size={16} /> : icon}
      {busy && !icon ? "Creating the draft…" : children}
    </button>
  );
}
