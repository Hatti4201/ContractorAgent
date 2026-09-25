"use client";

import { CircleAlert, CircleX, FileText, Loader, ScanSearch, UserRoundX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ClipboardEvent, type FormEvent } from "react";
import { clipboardHtmlToText, MAX_SWEEP_LENGTH, splitFeed } from "@/lib/linkedin-feed";

/**
 * The paste box. Safari puts the page on the clipboard as HTML as well as text; the text alone loses
 * every link, and with them the authors' profiles, so the HTML is read when it is there.
 */
export function SweepPaste() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const posts = useMemo(() => splitFeed(text), [text]);
  const withProfiles = posts.filter((post) => post.profileUrl).length;

  function paste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const html = event.clipboardData.getData("text/html");
    if (!html) return;
    const converted = clipboardHtmlToText(html, (value) => new DOMParser().parseFromString(value, "text/html"));
    // Only a page the splitter can read replaces the plain paste; anything else pastes as usual.
    if (!splitFeed(converted).length) return;
    event.preventDefault();
    setText(converted);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSending(true);
    try {
      const response = await fetch("/api/sweep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const result = await response.json().catch(() => ({})) as { error?: unknown };
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "The sweep could not be started.");
      setText("");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The sweep could not be started.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm" onSubmit={submit}>
      <textarea
        aria-label="Paste the whole LinkedIn page"
        className="h-24 w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs outline-none focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
        maxLength={MAX_SWEEP_LENGTH}
        onChange={(event) => setText(event.target.value)}
        onPaste={paste}
        placeholder="Group → search → Past 24 hours → Show more ×4 → ⌘A ⌘C → paste here"
        value={text}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2" aria-live="polite">
        {text && (posts.length
          ? (
            <>
              <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-sm font-semibold text-slate-700" title="Posts found">
                <FileText aria-hidden="true" size={14} />{posts.length}
              </span>
              {withProfiles < posts.length && (
                <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-sm font-semibold text-amber-900" title="Posts whose author link was lost in the paste">
                  <UserRoundX aria-hidden="true" size={14} />{posts.length - withProfiles}
                </span>
              )}
            </>
          )
          : (
            <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-sm font-semibold text-amber-900" title="No posts found: copy the whole page, not part of a post">
              <CircleAlert aria-hidden="true" size={14} />0
            </span>
          ))}
        {error && <span className="flex items-center gap-1 text-sm font-medium text-red-700" title={error}><CircleX aria-hidden="true" size={15} /><span className="max-w-md truncate">{error}</span></span>}
        <button
          aria-label={`Sweep ${posts.length} posts`}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={sending || !posts.length}
          title="Sweep"
          type="submit"
        >
          {sending ? <Loader aria-hidden="true" className="animate-spin" size={16} /> : <ScanSearch aria-hidden="true" size={16} />}
          {posts.length || ""}
        </button>
      </div>
    </form>
  );
}

/** Keeps the page current while a sweep or its jobs are still running. */
export function SweepRefresher({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}
