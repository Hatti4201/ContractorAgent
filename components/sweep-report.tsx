"use client";

import Link from "next/link";
import {
  Ban, BadgeCheck, CircleX, Clock, Eye, EyeOff, FileText, Loader, Mail, MailOpen, MailX, MapPin, MapPinOff, Percent, Repeat,
  Send, ShieldAlert, TriangleAlert, UserRound, Users, Briefcase, Copy, CircleHelp, type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import type { ReasonKind } from "@/services/sweep-plan";

export type SweepGroup = "needs" | "ready" | "working" | "outlook" | "soon" | "sent" | "skipped" | "not";

export type SweepPostView = {
  id: string;
  title: string;
  href: string | null;
  author: string;
  profileUrl: string | null;
  email: string | null;
  match: number | null;
  group: SweepGroup;
  /** The full sentence, shown on hover only. */
  reason: string | null;
  tag: { kind: ReasonKind; label: string } | null;
  excerpt: string;
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

export const groups: Record<SweepGroup, { icon: LucideIcon; tone: string; tip: string }> = {
  needs: { icon: TriangleAlert, tone: "text-amber-600", tip: "Needs you" },
  ready: { icon: Eye, tone: "text-sky-600", tip: "Email written, waiting for your review" },
  working: { icon: Loader, tone: "text-slate-500", tip: "Preparing" },
  outlook: { icon: MailOpen, tone: "text-blue-600", tip: "Draft in Outlook" },
  soon: { icon: Clock, tone: "text-emerald-600", tip: "Sending soon" },
  sent: { icon: Send, tone: "text-emerald-700", tip: "Sent" },
  skipped: { icon: Ban, tone: "text-slate-500", tip: "Skipped by your rules" },
  not: { icon: EyeOff, tone: "text-slate-400", tip: "Not for you: hotlists, candidates, other roles" },
};
const order: SweepGroup[] = ["needs", "ready", "working", "outlook", "soon", "sent", "skipped", "not"];

const tagIcons: Record<ReasonKind, LucideIcon> = {
  rules: MapPinOff, local: MapPin, f2f: Users, noise: Ban, role: Briefcase, email: MailX, match: Percent,
  eligibility: ShieldAlert, resume: FileText, duplicate: Copy, "email-check": BadgeCheck, failed: CircleX, review: Eye, other: CircleHelp,
};

function PostRow({ post }: { post: SweepPostView }) {
  const [showPost, setShowPost] = useState(false);
  const TagIcon = post.tag ? tagIcons[post.tag.kind] : null;
  return (
    <li className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="flex items-center gap-2">
        {post.href
          ? <Link className="min-w-0 truncate text-sm font-medium text-slate-900 hover:text-emerald-700" href={post.href} title={post.title}>{post.title}</Link>
          : <span className="min-w-0 truncate text-sm font-medium text-slate-900" title={post.title}>{post.title}</span>}
        {post.tag && TagIcon && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600" title={post.reason ?? undefined}>
            <TagIcon aria-hidden="true" size={12} />{post.tag.label}
          </span>
        )}
        {post.match != null && post.tag?.kind !== "match" && (
          <span className="shrink-0 text-xs font-semibold text-slate-500" title="Match">{Math.round(post.match * 100)}%</span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-0.5 text-slate-400">
          {post.profileUrl
            ? <a aria-label={`${post.author} on LinkedIn`} className="rounded p-1 hover:bg-slate-100 hover:text-slate-900" href={post.profileUrl} rel="noreferrer" target="_blank" title={post.author}><UserRound aria-hidden="true" size={15} /></a>
            : <span className="p-1" title={post.author}><UserRound aria-hidden="true" size={15} /></span>}
          {post.email && <a aria-label={`Email ${post.email}`} className="rounded p-1 hover:bg-slate-100 hover:text-slate-900" href={`mailto:${post.email}`} title={post.email}><Mail aria-hidden="true" size={15} /></a>}
          <button aria-expanded={showPost} aria-label="Show the post" className={`rounded p-1 hover:bg-slate-100 hover:text-slate-900 ${showPost ? "text-slate-900" : ""}`} onClick={() => setShowPost(!showPost)} title="Show the post" type="button">
            <FileText aria-hidden="true" size={15} />
          </button>
        </span>
      </div>
      {showPost && <p className="mt-2 whitespace-pre-wrap border-t border-slate-100 pt-2 text-xs text-slate-600">{post.excerpt}</p>}
    </li>
  );
}

/** One sweep: a row of counts, and the list behind whichever count is picked. */
export function SweepCard({ sweep, latest }: { sweep: SweepCardView; latest: boolean }) {
  const byGroup = Object.fromEntries(order.map((group) => [group, sweep.posts.filter((post) => post.group === group)])) as Record<SweepGroup, SweepPostView[]>;
  const first = latest ? order.slice(0, 2).find((group) => byGroup[group].length) ?? null : null;
  const [open, setOpen] = useState<SweepGroup | null>(first);

  return (
    <section aria-label={`Sweep ${sweep.when}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-sm font-semibold text-slate-800">{sweep.when}</span>
        <span className="mr-1 flex items-center gap-1 text-xs text-slate-400" title="Posts pasted">
          <FileText aria-hidden="true" size={13} />{sweep.postCount}
        </span>
        {sweep.running && (
          <span className="flex items-center gap-1 text-xs text-slate-500" title="Working">
            <Loader aria-hidden="true" className="animate-spin" size={13} />{sweep.progress}
          </span>
        )}
        {order.map((group) => {
          const count = byGroup[group].length;
          if (!count) return null;
          const { icon: Icon, tone, tip } = groups[group];
          const active = open === group;
          return (
            <button
              aria-label={`${tip}: ${count}`}
              aria-pressed={active}
              className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-sm font-semibold ${active ? "border-slate-900 bg-white text-slate-950" : "border-transparent bg-white/60 text-slate-700 hover:border-slate-300"}`}
              key={group}
              onClick={() => setOpen(active ? null : group)}
              title={tip}
              type="button"
            >
              <Icon aria-hidden="true" className={tone} size={14} />{count}
            </button>
          );
        })}
        {sweep.repeats > 0 && (
          <span className="ml-auto flex items-center gap-1 text-xs text-slate-400" title="Seen in an earlier sweep, skipped">
            <Repeat aria-hidden="true" size={13} />{sweep.repeats}
          </span>
        )}
      </div>
      {sweep.error && <p className="mt-2 flex items-center gap-1.5 text-sm text-red-700" title={sweep.error}><CircleX aria-hidden="true" size={15} /><span className="truncate">{sweep.error}</span></p>}
      {open && byGroup[open].length > 0 && (
        <ul className="mt-2 space-y-1.5">{byGroup[open].map((post) => <PostRow key={post.id} post={post} />)}</ul>
      )}
    </section>
  );
}
