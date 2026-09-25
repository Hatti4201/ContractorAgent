import Link from "next/link";
import { Ban, FilePen, Mail, Pause, Play, RotateCcw, Send, type LucideIcon } from "lucide-react";
import { runAutopilotOnWaiting } from "@/app/(protected)/dashboard/actions";
import { reviewSkippedIntake } from "@/app/(protected)/sweep/actions";
import { SweepPaste, SweepRefresher } from "@/components/sweep-paste";
import { SweepCard, type SweepCardView, type SweepGroup } from "@/components/sweep-report";
import { Toast } from "@/components/toast";
import { requireAuth } from "@/lib/auth";
import { formatDateTime, formatEnum } from "@/lib/job-values";
import { currentAutopilotMode } from "@/services/auto-send";
import { waitingForAutopilot } from "@/services/autopilot-batch";
import { recentSweeps, skippedByRules, type SweepView } from "@/services/sweep";
import { shortReason } from "@/services/sweep-plan";

type Post = SweepView["posts"][number];

const modes: Record<"off" | "draft" | "shadow" | "send", { icon: LucideIcon; label: string; tone: string }> = {
  off: { icon: Pause, label: "Off", tone: "border-amber-300 bg-amber-50 text-amber-900" },
  draft: { icon: FilePen, label: "Drafts", tone: "border-sky-200 bg-sky-50 text-sky-900" },
  shadow: { icon: FilePen, label: "Drafts", tone: "border-sky-200 bg-sky-50 text-sky-900" },
  send: { icon: Send, label: "Send", tone: "border-emerald-200 bg-emerald-50 text-emerald-900" },
};

const byState: Partial<Record<string, SweepGroup>> = {
  NEEDS_YOU: "needs", READY: "ready", WORKING: "working", IN_OUTLOOK: "outlook", SCHEDULED: "soon", SENT: "sent", SKIPPED: "skipped",
};

function groupOf(post: Post): SweepGroup {
  if (post.outcome === "NO_EMAIL" || post.outcome === "FAILED") return "needs";
  if (post.outcome === "SKIPPED") return "skipped";
  if (post.outcome === "NOISE" || post.outcome === "NOT_RELEVANT") return "not";
  return (post.state && byState[post.state]) || "working";
}

/** The screen's title, or the post's first line when screening never ran. */
function titleOf(post: Post) {
  return post.title ?? (post.excerpt.split("\n").find((line) => line.trim())?.trim().slice(0, 120) || "Untitled post");
}

function cardView(sweep: SweepView): SweepCardView {
  return {
    id: sweep.id,
    when: formatDateTime(sweep.createdAt),
    running: sweep.status === "RUNNING",
    progress: sweep.progress,
    error: sweep.error,
    postCount: sweep.postCount,
    repeats: sweep.repeats,
    posts: sweep.posts.map((post) => {
      const reason = post.detail ?? post.reason;
      return {
        id: post.id,
        title: titleOf(post),
        href: post.opportunityId ? `/jobs/${post.opportunityId}/outreach` : post.intakeId ? `/intakes/${post.intakeId}/review` : null,
        author: post.author,
        profileUrl: post.profileUrl,
        email: post.email,
        match: post.matchScore,
        group: groupOf(post),
        reason,
        tag: shortReason(reason),
        excerpt: post.excerpt,
      };
    }),
  };
}

function runNotice(run: number) {
  if (run > 0) return { text: `Running on ${run}`, tone: "ok" as const };
  if (run === -1) return { text: "Already running", tone: "warn" as const };
  return { text: "Nothing to run", tone: "warn" as const };
}

export default async function SweepPage({ searchParams }: { searchParams: Promise<{ error?: string; autopilotRun?: string }> }) {
  await requireAuth();
  const [{ error, autopilotRun }, sweeps, skipped, mode, waiting] = await Promise.all([searchParams, recentSweeps(), skippedByRules(), currentAutopilotMode(), waitingForAutopilot()]);
  const active = sweeps.some((sweep) => sweep.status === "RUNNING" || sweep.posts.some((post) => post.state === "WORKING" || post.state === "SCHEDULED"));
  const notice = autopilotRun === undefined ? null : runNotice(Number(autopilotRun));
  const { icon: ModeIcon, label, tone } = modes[mode];

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <SweepRefresher active={active} />
      {notice && <Toast clear={["autopilotRun"]} text={notice.text} tone={notice.tone} />}
      {error && <Toast clear={["error"]} text="No longer skipped" tone="warn" />}

      <div className="mb-3 flex items-center gap-2">
        <Link
          aria-label={`Autopilot: ${label}. Change it on the dashboard`}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold ${tone}`}
          href="/dashboard#autopilot"
          title={mode === "off" ? "Autopilot off: swept jobs wait for your review. Click to change" : "Autopilot · click to change"}
        >
          <ModeIcon aria-hidden="true" size={14} />{label}
        </Link>
        {mode !== "off" && waiting.length > 0 && (
          <form action={runAutopilotOnWaiting.bind(null, "/sweep")}>
            <button
              aria-label={`Run the autopilot on ${waiting.length} jobs waiting with a finished email`}
              className="flex items-center gap-1.5 rounded-full bg-sky-700 px-3 py-1 text-sm font-semibold text-white hover:bg-sky-800"
              title={`Run the autopilot on ${waiting.length} jobs waiting with a finished email`}
              type="submit"
            >
              <Play aria-hidden="true" size={13} />{waiting.length}
            </button>
          </form>
        )}
      </div>

      <SweepPaste />

      <div className="mt-4 space-y-2">
        {sweeps.map((sweep, index) => <SweepCard key={sweep.id} latest={index === 0} sweep={cardView(sweep)} />)}
      </div>

      {skipped.length > 0 && (
        <details className="mt-6">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-slate-600 [&::-webkit-details-marker]:hidden" title="Skipped by your rules this week, from every source">
            <Ban aria-hidden="true" size={15} />{skipped.length}<span className="font-normal text-slate-400">· 7d</span>
          </summary>
          <ul className="mt-2 space-y-1.5">
            {skipped.map((item) => {
              const tag = shortReason(item.reason);
              return (
                <li className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2" key={item.id}>
                  <Mail aria-hidden="true" className="shrink-0 text-slate-300" size={14} />
                  <span className="min-w-0 truncate text-sm font-medium text-slate-900" title={`${formatEnum(item.sourceType)}${item.recruiter ? ` · ${item.recruiter}` : ""} · ${formatDateTime(item.at)}`}>{item.title}</span>
                  {tag && <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600" title={item.reason ?? undefined}>{tag.label}</span>}
                  <form action={reviewSkippedIntake.bind(null, item.id)} className="ml-auto shrink-0">
                    <button aria-label={`Review ${item.title} anyway`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900" title="Review anyway" type="submit">
                      <RotateCcw aria-hidden="true" size={15} />
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}
