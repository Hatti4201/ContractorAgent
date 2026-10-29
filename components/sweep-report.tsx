"use client";

import Link from "next/link";
import {
  ArrowUpRight, Ban, BadgeCheck, CircleX, Clock, Eye, EyeOff, ExternalLink, FileText, Loader, MailOpen, MailX, MapPin, MapPinOff, Percent, Repeat,
  ListRestart, RotateCcw, RotateCw, Send, ShieldAlert, TriangleAlert, UserRound, Users, Briefcase, Copy, CircleHelp, type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { HoverLabel, labelScope } from "@/components/hover-label";
import type { ReasonKind } from "@/services/sweep-plan";

export type SweepGroup = "needs" | "ready" | "working" | "outlook" | "soon" | "sent" | "skipped" | "not";

export type SweepPostView = {
  id: string;
  title: string;
  href: string | null;
  author: string;
  profileUrl: string | null;
  postUrl: string | null;
  explicitC2C: boolean;
  email: string | null;
  reachOut: string | null;
  match: number | null;
  group: SweepGroup;
  /** The full sentence, shown on hover only. */
  reason: string | null;
  tag: { kind: ReasonKind; label: string } | null;
  excerpt: string;
  restore: boolean;
  outlookLink: string | null;
  resweepable: boolean;
};

export type SweepCardView = {
  id: string;
  when: string;
  running: boolean;
  progress: string | null;
  error: string | null;
  postCount: number;
  repeats: number;
  posts: SweepPostView[];
};

/** `short` shows under the count while the pointer is over the bar; `tip` is read by screen readers. */
export const groups: Record<SweepGroup, { icon: LucideIcon; tone: string; tip: string; short: string }> = {
  needs: { icon: TriangleAlert, tone: "text-amber-600", tip: "Needs you", short: "需处理" },
  ready: { icon: Eye, tone: "text-sky-600", tip: "Email written, waiting for your review", short: "待审阅" },
  working: { icon: Loader, tone: "text-slate-500", tip: "Preparing", short: "处理中" },
  outlook: { icon: MailOpen, tone: "text-blue-600", tip: "Draft in Outlook", short: "草稿" },
  soon: { icon: Clock, tone: "text-emerald-600", tip: "Sending soon", short: "待发送" },
  sent: { icon: Send, tone: "text-emerald-700", tip: "Sent", short: "已发送" },
  skipped: { icon: Ban, tone: "text-slate-500", tip: "Skipped by your rules", short: "已跳过" },
  not: { icon: EyeOff, tone: "text-slate-400", tip: "Not for you: hotlists, candidates, other roles", short: "不相关" },
};
const order: SweepGroup[] = ["needs", "ready", "working", "outlook", "soon", "sent", "skipped", "not"];

const tagOrder: ReasonKind[] = ["resume", "experience", "rules", "local", "f2f", "eligibility", "email", "duplicate", "match", "noise", "role", "failed", "review", "email-check", "other"];

function sortPosts(a: SweepPostView, b: SweepPostView) {
  const tagA = a.tag ? tagOrder.indexOf(a.tag.kind) : tagOrder.length;
  const tagB = b.tag ? tagOrder.indexOf(b.tag.kind) : tagOrder.length;
  return tagA - tagB || (a.tag?.label ?? "").localeCompare(b.tag?.label ?? "") || a.title.localeCompare(b.title);
}

const tagIcons: Record<ReasonKind, LucideIcon> = {
  rules: MapPinOff, local: MapPin, f2f: Users, noise: Ban, role: Briefcase, email: MailX, match: Percent,
  eligibility: ShieldAlert, resume: FileText, experience: Clock, duplicate: Copy, "email-check": BadgeCheck, failed: CircleX, review: Eye, other: CircleHelp,
};

function PostRow({ post, onResweep, resweeping }: { post: SweepPostView; onResweep: () => void; resweeping: boolean }) {
  const [showPost, setShowPost] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reachOutCopied, setReachOutCopied] = useState(false);
  const TagIcon = post.tag ? tagIcons[post.tag.kind] : null;

  async function copyProfileUrl() {
    if (!post.profileUrl) return;
    await navigator.clipboard.writeText(post.profileUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function copyReachOut() {
    if (!post.reachOut) return;
    await navigator.clipboard.writeText(post.reachOut);
    setReachOutCopied(true);
    window.setTimeout(() => setReachOutCopied(false), 1500);
  }

  return (
    <li
      className={`${labelScope.row} cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-2 hover:border-slate-300`}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a,button,form")) return;
        setShowPost((value) => !value);
      }}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
          event.preventDefault();
          setShowPost((value) => !value);
        }
      }}
      tabIndex={0}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-slate-900" title={post.title}>{post.title}</span>
        {post.tag && TagIcon && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600" title={post.reason ?? undefined}>
            <TagIcon aria-hidden="true" size={12} />{post.tag.label}
          </span>
        )}
        {post.match != null && post.tag?.kind !== "match" && (
          <span aria-label={`Match ${Math.round(post.match * 100)}%`} className="flex shrink-0 items-center gap-1 text-xs font-semibold text-slate-500">
            {Math.round(post.match * 100)}%<HoverLabel scope="row" text="匹配度" variant="inline" />
          </span>
        )}
        {/* The row's actions sit too close for floating labels, so theirs appear beside each icon. */}
        <span className="ml-auto flex shrink-0 items-center gap-0.5 text-slate-400">
          {post.profileUrl
            ? <button aria-label={`Copy LinkedIn profile link for ${post.author}`} className="flex items-center gap-1 rounded p-1 hover:bg-slate-100 hover:text-slate-900" onClick={copyProfileUrl} title={copied ? "已复制" : "复制发帖人链接"} type="button"><UserRound aria-hidden="true" size={15} /><HoverLabel scope="row" text={copied ? "已复制" : "复制链接"} variant="inline" /></button>
            : <span aria-label={post.author} className="flex items-center gap-1 p-1" title={post.author}><UserRound aria-hidden="true" size={15} /><HoverLabel scope="row" text="发帖人" variant="inline" /></span>}
          {post.email && post.reachOut && <button aria-label={`Copy LinkedIn reach-out for ${post.title}`} className="flex items-center gap-1 rounded p-1 hover:bg-slate-100 hover:text-slate-900" onClick={copyReachOut} title={reachOutCopied ? "已复制" : "复制 Reach-out 草稿"} type="button"><Copy aria-hidden="true" size={15} /><HoverLabel scope="row" text={reachOutCopied ? "已复制" : "复制草稿"} variant="inline" /></button>}
          {post.postUrl && post.explicitC2C && <a aria-label={`Open original LinkedIn post for ${post.title}`} className="flex items-center gap-1 rounded p-1 hover:bg-slate-100 hover:text-slate-900" href={post.postUrl} rel="noreferrer" target="_blank" title="原帖留言"><ExternalLink aria-hidden="true" size={15} /><HoverLabel scope="row" text="原帖留言" variant="inline" /></a>}
          {post.outlookLink && (post.group === "outlook" || post.group === "soon") && <a aria-label={`Open Outlook draft for ${post.title}`} className="flex items-center gap-1 rounded p-1 hover:bg-slate-100 hover:text-slate-900" href={post.outlookLink} rel="noreferrer" target="_blank" title="打开 Outlook 草稿"><MailOpen aria-hidden="true" size={15} /><HoverLabel scope="row" text="打开 Outlook 草稿" variant="inline" /></a>}
          {post.href && <Link aria-label={`Open job detail for ${post.title}`} className="flex items-center gap-1 rounded p-1 hover:bg-slate-100 hover:text-slate-900" href={post.href} title="Job detail"><ArrowUpRight aria-hidden="true" size={15} /><HoverLabel scope="row" text="Job detail" variant="inline" /></Link>}
          {post.restore && <form action={`/api/sweep/post/${post.id}/restore`} method="post"><button aria-label={`Restore ${post.title} to autopilot`} className="flex items-center gap-1 rounded p-1 hover:bg-slate-100 hover:text-slate-900" title="Restore to autopilot" type="submit"><RotateCcw aria-hidden="true" size={15} /><HoverLabel scope="row" text="恢复自动处理" variant="inline" /></button></form>}
          {post.resweepable && <button aria-label={`Resweep ${post.title}`} className="flex items-center gap-1 rounded p-1 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50" disabled={resweeping} onClick={onResweep} title="重新扫描" type="button"><RotateCw aria-hidden="true" className={resweeping ? "animate-spin" : ""} size={15} /><HoverLabel scope="row" text="重新扫描" variant="inline" /></button>}
        </span>
      </div>
      {showPost && <p className="mt-2 whitespace-pre-wrap border-t border-slate-100 pt-2 text-xs text-slate-600">{post.excerpt}</p>}
    </li>
  );
}

/** One sweep: a row of counts, and the list behind whichever count is picked. */
export function SweepCard({ sweep, latest }: { sweep: SweepCardView; latest: boolean }) {
  const router = useRouter();
  const byGroup = Object.fromEntries(order.map((group) => [group, sweep.posts.filter((post) => post.group === group).sort(sortPosts)])) as Record<SweepGroup, SweepPostView[]>;
  const first = latest ? order.slice(0, 2).find((group) => byGroup[group].length) ?? null : null;
  const [open, setOpen] = useState<SweepGroup | null>(first);
  const [resweeping, setResweeping] = useState(false);
  const [resweepPostId, setResweepPostId] = useState<string | null>(null);
  const [resweepNotice, setResweepNotice] = useState<string | null>(null);
  const [resweepError, setResweepError] = useState<string | null>(null);
  const stale = sweep.error?.startsWith("The server stopped before this sweep finished.") ?? false;
  const error = stale
    ? "The server stopped before this sweep finished. Use Resume this sweep to continue the saved posts; paste the page again only for posts that were never recorded."
    : sweep.error;

  async function resweep(scope: "all" | "needs", postId?: string) {
    setResweeping(true);
    setResweepPostId(postId ?? null);
    setResweepNotice(null);
    setResweepError(null);
    try {
      const response = await fetch(`/api/sweep/${sweep.id}/resweep`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope, ...(postId ? { postId } : {}) }) });
      const result = await response.json().catch(() => ({})) as { count?: unknown; error?: unknown };
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Could not start the resweep.");
      const count = typeof result.count === "number" ? result.count : 0;
      setResweepNotice(count ? (postId ? "Resweep started for this job." : `Resweep started for ${count} unfinished jobs.`) : "No unfinished jobs can be resumed from this sweep.");
      router.refresh();
    } catch (error) {
      setResweepError(error instanceof Error ? error.message : "Could not start the resweep.");
    } finally {
      setResweeping(false);
      setResweepPostId(null);
    }
  }

  return (
    <section aria-label={`Sweep ${sweep.when}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <div className={`${labelScope.bar} flex flex-wrap items-center gap-1.5`}>
        <span className="mr-1 text-sm font-semibold text-slate-800">{sweep.when}</span>
        <span aria-label={`Posts pasted: ${sweep.postCount}`} className="relative mr-1 flex items-center gap-1 text-xs text-slate-400">
          <FileText aria-hidden="true" size={13} />{sweep.postCount}
          <HoverLabel scope="bar" text="帖子数" />
        </span>
        {sweep.running && (
          <span aria-label="Working" className="relative flex items-center gap-1 text-xs text-slate-500">
            <Loader aria-hidden="true" className="animate-spin" size={13} />{sweep.progress}
            <HoverLabel scope="bar" text="处理中" />
          </span>
        )}
        {order.map((group) => {
          const count = byGroup[group].length;
          if (!count) return null;
          const { icon: Icon, tone, tip, short } = groups[group];
          const active = open === group;
          return (
            <button
              aria-label={`${tip}: ${count}`}
              aria-pressed={active}
              className={`relative flex items-center gap-1 rounded-full border px-2.5 py-1 text-sm font-semibold ${active ? "border-slate-900 bg-white text-slate-950" : "border-transparent bg-white/60 text-slate-700 hover:border-slate-300"}`}
              key={group}
              onClick={() => setOpen(active ? null : group)}
              type="button"
            >
              <Icon aria-hidden="true" className={tone} size={14} />{count}
              <HoverLabel scope="bar" text={short} />
            </button>
          );
        })}
        {sweep.repeats > 0 && (
          <span aria-label={`Seen in an earlier sweep, skipped: ${sweep.repeats}`} className="relative ml-auto flex items-center gap-1 text-xs text-slate-400">
            <Repeat aria-hidden="true" size={13} />{sweep.repeats}
            <HoverLabel scope="bar" text="重复" />
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <button aria-label={`Resweep selected category in ${sweep.when}`} className="relative flex items-center gap-1 rounded-full border border-transparent bg-white/60 px-2.5 py-1 text-sm font-semibold text-slate-700 hover:border-slate-300 disabled:opacity-50" disabled={resweeping || sweep.running || open !== "needs"} onClick={() => resweep("needs")} title={open === "needs" ? "Retry only Needs you" : "Select Needs you to retry only that category"} type="button">
            <RotateCcw aria-hidden="true" className={resweeping ? "animate-spin" : ""} size={14} />
            <HoverLabel scope="bar" text="仅重扫" />
          </button>
          <button aria-label={`${stale ? "Resume" : "Resweep all unfinished jobs"} in ${sweep.when}`} className="relative flex items-center gap-1 rounded-full border border-transparent bg-white/60 px-2.5 py-1 text-sm font-semibold text-slate-700 hover:border-slate-300 disabled:opacity-50" disabled={resweeping || sweep.running} onClick={() => resweep("all")} title={stale ? "Resume this interrupted sweep" : "Retry all unfinished jobs from this sweep"} type="button">
            <ListRestart aria-hidden="true" className={resweeping ? "animate-spin" : ""} size={14} />
            <HoverLabel scope="bar" text={stale ? "恢复这次扫描" : "全部重扫"} />
          </button>
        </span>
      </div>
      {error && <p className="mt-2 flex items-center gap-1.5 text-sm text-red-700" title={error}><CircleX aria-hidden="true" size={15} /><span className="truncate">{error}</span></p>}
      {resweepNotice && <p className="mt-2 flex items-center gap-1.5 text-sm text-emerald-700" role="status"><BadgeCheck aria-hidden="true" size={15} /><span>{resweepNotice}</span></p>}
      {resweepError && <p className="mt-2 flex items-center gap-1.5 text-sm text-red-700" role="alert"><CircleX aria-hidden="true" size={15} /><span>{resweepError}</span></p>}
      {open && byGroup[open].length > 0 && (
        <ul className="mt-2 space-y-1.5">{byGroup[open].map((post) => <PostRow key={post.id} post={post} onResweep={() => resweep("all", post.id)} resweeping={resweeping && resweepPostId === post.id} />)}</ul>
      )}
    </section>
  );
}
