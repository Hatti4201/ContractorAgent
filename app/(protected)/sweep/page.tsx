import Link from "next/link";
import { reviewSkippedIntake } from "@/app/(protected)/sweep/actions";
import { SweepPaste, SweepRefresher } from "@/components/sweep-paste";
import { requireAuth } from "@/lib/auth";
import { formatDateTime, formatEnum } from "@/lib/job-values";
import { autopilotMode } from "@/services/autopilot";
import { recentSweeps, skippedByRules, type SweepView } from "@/services/sweep";

type Post = SweepView["posts"][number];

const stateLabels: Record<string, { label: string; tone: string }> = {
  SENT: { label: "Sent", tone: "bg-emerald-100 text-emerald-900" },
  SCHEDULED: { label: "Sending soon", tone: "bg-emerald-50 text-emerald-800" },
  IN_OUTLOOK: { label: "Draft in Outlook", tone: "bg-sky-100 text-sky-900" },
  WORKING: { label: "Preparing", tone: "bg-slate-100 text-slate-700" },
  NEEDS_YOU: { label: "Needs you", tone: "bg-amber-100 text-amber-900" },
  SKIPPED: { label: "Skipped", tone: "bg-slate-100 text-slate-700" },
};

const percent = (value: number | null) => (value === null ? null : `${Math.round(value * 100)}% match`);

/** The screen's title, or the post's first line when screening never ran. */
function titleOf(post: Post) {
  return post.title ?? (post.excerpt.split("\n").find((line) => line.trim())?.trim().slice(0, 120) || "Untitled post");
}

function needsYou(post: Post) {
  return post.outcome === "NO_EMAIL" || post.outcome === "FAILED" || post.state === "NEEDS_YOU";
}

function Author({ post }: { post: Post }) {
  return post.profileUrl
    ? <a className="font-medium text-emerald-700 underline" href={post.profileUrl} rel="noreferrer" target="_blank">{post.author}</a>
    : <span className="font-medium">{post.author}</span>;
}

function Excerpt({ post }: { post: Post }) {
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs text-slate-500">Show post</summary>
      <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{post.excerpt}</p>
    </details>
  );
}

function PostRow({ post, showReason = true }: { post: Post; showReason?: boolean }) {
  const state = post.state ? stateLabels[post.state] : null;
  const link = post.opportunityId ? `/jobs/${post.opportunityId}/outreach` : post.intakeId ? `/intakes/${post.intakeId}/review` : null;
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {link
            ? <Link className="font-semibold text-slate-950 underline" href={link}>{titleOf(post)}</Link>
            : <span className="font-semibold text-slate-950">{titleOf(post)}</span>}
          <p className="mt-0.5 text-slate-600">
            <Author post={post} />
            {post.email && <> · {post.email}</>}
            {percent(post.matchScore) && <> · {percent(post.matchScore)}</>}
          </p>
          {showReason && (post.detail ?? post.reason) && <p className="mt-1 text-slate-700">{post.detail ?? post.reason}</p>}
          <Excerpt post={post} />
        </div>
        {state && <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${state.tone}`}>{state.label}</span>}
      </div>
    </li>
  );
}

function Group({ title, posts, open = false, showReason = true }: { title: string; posts: Post[]; open?: boolean; showReason?: boolean }) {
  if (!posts.length) return null;
  return (
    <details className="mt-4" open={open}>
      <summary className="cursor-pointer text-sm font-semibold text-slate-900">{title} ({posts.length})</summary>
      <ul className="mt-2 space-y-2">{posts.map((post) => <PostRow key={post.id} post={post} showReason={showReason} />)}</ul>
    </details>
  );
}

function SweepReport({ sweep, latest }: { sweep: SweepView; latest: boolean }) {
  const posts = sweep.posts;
  const count = (test: (post: Post) => boolean) => posts.filter(test).length;
  const onTheirWay = posts.filter((post) => post.state && ["SENT", "SCHEDULED", "IN_OUTLOOK", "WORKING"].includes(post.state));
  const summary = [
    `${sweep.postCount} posts`,
    sweep.repeats ? `${sweep.repeats} seen before` : null,
    `${count((post) => post.state === "SENT")} sent`,
    `${count((post) => post.state === "SCHEDULED")} sending soon`,
    `${count((post) => post.state === "IN_OUTLOOK")} in Outlook`,
    `${count(needsYou)} need you`,
    `${count((post) => post.outcome === "SKIPPED" || post.state === "SKIPPED")} skipped by your rules`,
    `${count((post) => post.outcome === "NOT_RELEVANT" || post.outcome === "NOISE")} not for you`,
  ].filter(Boolean).join(" · ");

  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-slate-950">Sweep of {formatDateTime(sweep.createdAt)}</h3>
        {sweep.status === "RUNNING" && <span className="text-sm text-slate-600">{sweep.progress ?? "Working"}…</span>}
      </div>
      <p className="mt-1 text-sm text-slate-700">{summary}</p>
      {sweep.error && <p className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">{sweep.error}</p>}
      <Group open={latest} posts={posts.filter(needsYou)} title="Needs you" />
      <Group open={latest} posts={onTheirWay} showReason={false} title="On their way" />
      <Group posts={posts.filter((post) => post.outcome === "SKIPPED" || post.state === "SKIPPED")} title="Skipped by your rules" />
      <Group posts={posts.filter((post) => post.outcome === "NOT_RELEVANT")} title="Outside your roles" />
      <Group posts={posts.filter((post) => post.outcome === "NOISE")} title="Not a job (hotlists, candidates, ads)" />
    </section>
  );
}

export default async function SweepPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireAuth();
  const [{ error }, sweeps, skipped] = await Promise.all([searchParams, recentSweeps(), skippedByRules()]);
  const active = sweeps.some((sweep) => sweep.status === "RUNNING" || sweep.posts.some((post) => post.state === "WORKING" || post.state === "SCHEDULED"));
  const mode = autopilotMode();

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <SweepRefresher active={active} />
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">LinkedIn Sweep</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Sweep a LinkedIn feed</h1>
      <p className="mt-3 text-sm text-slate-600">
        Every post is screened once: hotlists and candidate posts are dropped, then your rules apply (W2 only in the Bay
        Area or remote; C2C anywhere except local-only; no face-to-face interview outside the Bay Area). Jobs with a
        recruiter email go through the {mode === "off" ? "review queue (the autopilot is off)" : "autopilot"}; posts without one are listed for you with the author&apos;s profile.
      </p>
      {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800" role="alert">That job is no longer skipped.</p>}

      <div className="mt-6"><SweepPaste /></div>

      {sweeps.map((sweep, index) => <SweepReport key={sweep.id} latest={index === 0} sweep={sweep} />)}

      {skipped.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl font-semibold text-slate-950">Skipped by your rules this week</h2>
          <p className="mt-1 text-sm text-slate-600">From every source, mail included. Review one anyway to put it back in the queue.</p>
          <ul className="mt-4 space-y-2">
            {skipped.map((item) => (
              <li className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm" key={item.id}>
                <div className="min-w-0">
                  <p className="font-semibold text-slate-950">{item.title}</p>
                  <p className="mt-0.5 text-slate-600">{formatEnum(item.sourceType)}{item.recruiter ? ` · ${item.recruiter}` : ""} · {formatDateTime(item.at)}</p>
                  {item.reason && <p className="mt-1 text-slate-700">{item.reason}</p>}
                </div>
                <form action={reviewSkippedIntake.bind(null, item.id)}>
                  <button className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-800 hover:bg-slate-50" type="submit">Review anyway</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
