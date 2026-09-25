"use client";

import { useState, useSyncExternalStore } from "react";
import { bookmarkletSource } from "@/lib/bookmarklet";

const noSubscription = () => () => {};

/**
 * The bookmarklet is copied, not dragged: React refuses to render a javascript: address, and Safari
 * takes a bookmark's address from its edit sheet anyway. It is built from the origin this page is
 * served on, so it points at the app however the user reaches it.
 */
export function BookmarkletInstall({ captureKey }: { captureKey: string }) {
  const origin = useSyncExternalStore(noSubscription, () => window.location.origin, () => "");
  const [copied, setCopied] = useState(false);
  const source = origin ? bookmarkletSource(origin, captureKey) : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mt-4 space-y-3 text-sm text-slate-700">
      <ol className="list-decimal space-y-1 pl-5">
        <li>Copy the code below.</li>
        <li>In Safari, bookmark any page into <span className="font-medium">Favorites</span> (⌘D), and name it <span className="font-medium">→ Agent</span>.</li>
        <li>Open <span className="font-medium">Bookmarks → Edit Bookmarks</span>, right-click it, choose <span className="font-medium">Edit Address</span>, and paste the code.</li>
        <li>On LinkedIn, open a post&apos;s <span className="font-medium">see more</span>, select its text, and click <span className="font-medium">→ Agent</span>.</li>
      </ol>
      <textarea aria-label="Bookmarklet code" className="h-24 w-full rounded-lg border border-slate-300 bg-slate-50 p-2 font-mono text-xs text-slate-800" readOnly value={source} />
      <div className="flex flex-wrap items-center gap-3">
        <button className="rounded-lg bg-slate-950 px-4 py-2 font-medium text-white hover:bg-slate-800 disabled:opacity-50" disabled={!source} onClick={copy} type="button">
          {copied ? "Copied" : "Copy bookmarklet"}
        </button>
        <p className="text-xs text-slate-500">It carries a private key; keep it to your own browser. Changing SESSION_SECRET retires it.</p>
      </div>
    </div>
  );
}
