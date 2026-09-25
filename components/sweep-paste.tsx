"use client";

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
    <form className="space-y-4" onSubmit={submit}>
      <label className="block text-sm font-medium text-slate-800">
        Paste the whole LinkedIn page
        <textarea
          className="mt-1.5 h-40 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-mono text-xs outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          maxLength={MAX_SWEEP_LENGTH}
          onChange={(event) => setText(event.target.value)}
          onPaste={paste}
          placeholder="In the group, search, filter to Past 24 hours, press Show more results 4–5 times, then Cmd+A, Cmd+C, and paste here."
          value={text}
        />
      </label>
      {text && (
        <p className={`text-sm ${posts.length ? "text-slate-700" : "text-amber-900"}`} aria-live="polite">
          {posts.length
            ? `${posts.length} posts found${withProfiles < posts.length ? `; ${posts.length - withProfiles} without a profile link` : ""}.`
            : "No posts found yet. Copy the whole page, not just part of a post."}
        </p>
      )}
      {error && <p aria-live="polite" className="rounded-lg bg-red-50 p-3 text-sm font-medium text-red-800">{error}</p>}
      <button className="rounded-lg bg-slate-950 px-5 py-3 font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60" disabled={sending || !posts.length} type="submit">
        {sending ? "Starting…" : `Sweep ${posts.length || ""} posts`.replace("  ", " ")}
      </button>
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
