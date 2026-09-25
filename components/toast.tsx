"use client";

import { CircleAlert, CircleCheck } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * A one-line notice that goes away on its own, and takes the query keys that raised it out of the
 * address, so a reload does not show it again.
 */
export function Toast({ text, tone = "ok", clear = [] }: { text: string; tone?: "ok" | "warn"; clear?: string[] }) {
  const [shown, setShown] = useState(true);

  useEffect(() => {
    if (clear.length) {
      const url = new URL(window.location.href);
      for (const key of clear) url.searchParams.delete(key);
      window.history.replaceState(window.history.state, "", url);
    }
    const timer = setTimeout(() => setShown(false), tone === "warn" ? 6000 : 3000);
    return () => clearTimeout(timer);
    // Once per notice; the keys are read on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!shown) return null;
  const Icon = tone === "ok" ? CircleCheck : CircleAlert;
  return (
    <p
      className={`fixed bottom-6 left-1/2 z-50 flex max-w-[90vw] -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium shadow-lg ${tone === "ok" ? "bg-emerald-700 text-white" : "bg-amber-400 text-amber-950"}`}
      role="status"
    >
      <Icon aria-hidden="true" size={16} />
      {text}
    </p>
  );
}
