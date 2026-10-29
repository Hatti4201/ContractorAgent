"use client";

import { ExternalLink, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { openConversationMessage, processConversationMessage } from "@/app/(protected)/conversations/actions";

export function ProcessConversationButton({ messageId }: { messageId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function process() {
    const tab = window.open("", "_blank");
    setBusy(true);
    setError(null);
    try {
      const result = await processConversationMessage(messageId);
      if (tab) tab.location.replace(result.url);
      else window.open(result.url, "_blank");
      router.refresh();
    } catch (caught) {
      tab?.close();
      setError(caught instanceof Error ? caught.message : "Could not create the Outlook draft.");
    } finally {
      setBusy(false);
    }
  }

  return <span className="mt-3 block"><button className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60" disabled={busy} onClick={process} type="button">{busy ? <LoaderCircle aria-hidden="true" className="animate-spin" size={13} /> : <ExternalLink aria-hidden="true" size={13} />} {busy ? "正在生成 Outlook draft…" : "处理这封邮件并打开 Draft"}</button>{error && <span className="mt-2 block text-xs font-medium text-red-700">{error}</span>}</span>;
}

export function OpenConversationMessageButton({ messageId }: { messageId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openMessage() {
    const tab = window.open("", "_blank");
    setBusy(true);
    setError(null);
    try {
      const result = await openConversationMessage(messageId);
      if (tab) tab.location.replace(result.url);
      else window.open(result.url, "_blank");
    } catch (caught) {
      tab?.close();
      setError(caught instanceof Error ? caught.message : "Could not open Outlook.");
    } finally {
      setBusy(false);
    }
  }

  return <span className="mt-2 block"><button className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60" disabled={busy} onClick={openMessage} type="button">{busy ? <LoaderCircle aria-hidden="true" className="animate-spin" size={13} /> : <ExternalLink aria-hidden="true" size={13} />} {busy ? "正在打开 Outlook…" : "打开 Outlook"}</button>{error && <span className="ml-2 text-xs font-medium text-red-700">{error}</span>}</span>;
}
