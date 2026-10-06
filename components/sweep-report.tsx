"use client";

import Link from "next/link";
import {
  ArrowUpRight, Ban, BadgeCheck, CircleX, Clock, Eye, EyeOff, ExternalLink, FileText, Loader, Mail, MailOpen, MailX, MapPin, MapPinOff, Percent, Repeat,
  ListRestart, RotateCcw, Send, ShieldAlert, TriangleAlert, UserRound, Users, Briefcase, Copy, CircleHelp, type LucideIcon,
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
  match: number | null;
  group: SweepGroup;
  /** The full sentence, shown on hover only. */
  reason: string | null;
  tag: { kind: ReasonKind; label: string } | null;
  excerpt: string;
  restore: boolean;
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

function PostRow({ post }: { post: SweepPostView }) {
  const [showPost, setShowPost] = useState(false);
  const TagIcon = post.tag ? tagIcons[post.tag.kind] : null;
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
            ? <a aria-label={`${post.author} on LinkedIn`} className="flex items-center gap-1 rounded p-1 hover:bg-slate-100 hover:text-slate-900" href={post.profileUrl} rel="noreferrer" target="_blank" title={post.author}><UserRound aria-hidden="true" size={15} /><HoverLabel scope="row" text="发帖人" variant="inline" /></a>
            : <span aria-label={post.author} className="flex items-center gap-1 p-1" title={post.author}><UserRound aria-hidden="true" size={15} /><HoverLabel scope="row" text="发帖人" variant="inline" /></span>}
          {post.email && <a aria-label={`Email ${post.email}`} className="flex items-center gap-1 rounded p-1 hover:bg-slate-100 hover:text-slate-900" href={`mailto:${post.email}`} title={post.email}><Mail aria-hidden="true" size={15} /><HoverLabel scope="row" text="发邮件" variant="inline" /></a>}
          {post.postUrl && post.explicitC2C && <a aria-label={`Open original LinkedIn post for ${post.title}`} className="flex items-center gap-1 rounded p-1 hover:bg-slate-100 hover:text-slate-900" href={post.postUrl} rel="noreferrer" target="_blank" title="原帖留言"><ExternalLink aria-hidden="true" size={15} /><HoverLabel scope="row" text="原帖留言" variant="inline" /></a>}
          {post.href && <Link aria-label={`Open job detail for ${post.title}`} className="flex items-center gap-1 rounded p-1 hover:bg-slate-100 hover:text-slate-900" href={post.href} title="Job detail"><ArrowUpRight aria-hidden="true" size={15} /><HoverLabel scope="row" text="Job detail" variant="inline" /></Link>}
          {post.restore && <form action={`/api/sweep/post/${post.id}/restore`} method="post"><button aria-label={`Restore ${post.title} to autopilot`} className="flex items-center gap-1 rounded p-1 hover:bg-slate-100 hover:text-slate-900" title="Restore to autopilot" type="submit"><RotateCcw aria-hidden="true" size={15} /><HoverLabel scope="row" text="恢复自动处理" variant="inline" /></button></form>}
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

  async function resweep(scope: "all" | "needs") {
    setResweeping(true);
    try {
      const response = await fetch(`/api/sweep/${sweep.id}/resweep`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope }) });
      if (!response.ok) throw new Error();
      router.refresh();
    } finally {
      setResweeping(false);
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
          <button aria-label={`Resweep all unfinished jobs in ${sweep.when}`} className="relative flex items-center gap-1 rounded-full border border-transparent bg-white/60 px-2.5 py-1 text-sm font-semibold text-slate-700 hover:border-slate-300 disabled:opacity-50" disabled={resweeping || sweep.running} onClick={() => resweep("all")} title="Retry all unfinished jobs from this sweep" type="button">
            <ListRestart aria-hidden="true" size={14} />
            <HoverLabel scope="bar" text="全部重扫" />
          </button>
        </span>
      </div>
      {sweep.error && <p className="mt-2 flex items-center gap-1.5 text-sm text-red-700" title={sweep.error}><CircleX aria-hidden="true" size={15} /><span className="truncate">{sweep.error}</span></p>}
      {open && byGroup[open].length > 0 && (
        <ul className="mt-2 space-y-1.5">{byGroup[open].map((post) => <PostRow key={post.id} post={post} />)}</ul>
      )}
    </section>
  );
}
