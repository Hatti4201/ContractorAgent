"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function IntakeInboxSync({ connected }: { connected: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<"syncing" | "done" | "error">("syncing");

  useEffect(() => {
    if (!connected) return;
    let active = true;
    fetch("/api/intake/inbox", { method: "POST", cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Outlook could not be read.");
        if (active) {
          setStatus("done");
          router.refresh();
        }
      })
      .catch(() => { if (active) setStatus("error"); });
    return () => { active = false; };
  }, [connected, router]);

  if (!connected || status === "done") return null;
  if (status === "error") return <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Outlook could not be read just now. Reconnect and reload.</p>;
  return <p className="mt-4 text-sm text-slate-500" role="status">Syncing Outlook inbox in the background…</p>;
}
