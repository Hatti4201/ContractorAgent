"use client";

import { Bot, CheckCircle2, CircleUserRound, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { addConversationToPipeline, addExistingJobToPipeline } from "@/app/(protected)/conversations/actions";

export type ConversationThread = {
  id: string;
  recruiterName: string;
  subject: string;
  displayTitle: string;
  receivedAt: string;
  currentStage: string;
  manualReview: boolean;
  summary: string;
  jobs: { id: string; title: string }[];
  messages: { id: string; label: string; body: string; summary: string; tone: "incoming" | "outgoing"; at: string; replyDraft: string | null }[];
  replyStatus: "needs_reply" | "waiting_reply";
  manualReply: boolean;
  pipelineMessageId: string | null;
  pipeline: { id: string; status: string; title: string | null; stage: string | null; hold: string | null } | null;
};

const pipeline = [
  { label: "Outreach", rank: 1 },
  { label: "Reply", rank: 2 },
  { label: "RTR", rank: 3 },
  { label: "Interview", rank: 4 },
] as const;

const stageRanks: Record<string, number> = {
  DISCOVERED: 0,
  OUTREACH_SENT: 1,
  RECRUITER_ENGAGED: 2,
  RTR_SIGNED: 3,
  SUBMITTED_TO_CLIENT: 3,
  INTERVIEW_SCHEDULED: 4,
  INTERVIEW_COMPLETED: 4,
  OFFER: 4,
  HIRED: 4,
};

function StageProgress({ currentStage }: { currentStage: string }) {
  const rank = stageRanks[currentStage] ?? 0;

  return (
    <div className="mt-4 flex max-w-xl items-start" aria-label={`Application stage: ${currentStage}`}>
      {pipeline.map((stage, index) => {
        const complete = rank >= stage.rank;
        const current = rank === stage.rank;
        return (
          <div className="flex min-w-0 flex-1 flex-col gap-1" key={stage.label}>
            <div className="flex items-center">
              <span aria-current={current ? "step" : undefined} className={`h-2.5 w-2.5 shrink-0 rounded-full border ${complete ? "border-emerald-600 bg-emerald-500" : "border-slate-300 bg-white"}`} title={current ? "当前阶段" : undefined} />
              {index < pipeline.length - 1 && <span className={`h-px flex-1 ${rank > stage.rank ? "bg-emerald-400" : "bg-slate-200"}`} />}
            </div>
            <span className={`text-[11px] ${complete ? "font-semibold text-emerald-700" : "text-slate-400"}`}>{stage.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function Bubble({ label, body, summary, tone, at, replyDraft }: { label: string; body: string; summary: string; tone: "incoming" | "outgoing"; at: string; replyDraft: string | null }) {
  const [original, setOriginal] = useState(false);
  const visibleBody = original ? body : summary;

  return (
    <div
      className={`max-w-3xl rounded-2xl px-4 py-3 shadow-sm ${tone === "incoming" ? "mr-auto rounded-tl-md border border-violet-200 bg-violet-50" : "ml-auto rounded-tr-md border border-emerald-200 bg-emerald-50"}`}
      onDoubleClick={() => setOriginal((value) => !value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") setOriginal((value) => !value);
      }}
      role="button"
      tabIndex={0}
      title="双击切换 AI 摘要和原文"
    >
      <p className={`text-xs font-semibold ${tone === "incoming" ? "text-violet-700" : "text-emerald-700"}`}>{label}</p>
      <p className="mt-1 text-[11px] text-slate-400">{at}</p>
      <p className={`mt-2 text-sm leading-6 ${original ? "whitespace-pre-wrap" : "truncate"} ${tone === "incoming" ? "text-violet-950" : "text-emerald-950"}`}>{visibleBody}</p>
      {replyDraft && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">待确认回复草稿：{replyDraft}</p>}
      <p className={`mt-2 text-[11px] ${tone === "incoming" ? "text-violet-500" : "text-emerald-600"}`}>{original ? "双击返回 AI summary" : "双击查看原文"}</p>
    </div>
  );
}

export function ConversationThreads({ threads }: { threads: ConversationThread[] }) {
  const [filter, setFilter] = useState<"all" | ConversationThread["replyStatus"]>("all");
  const visibleThreads = useMemo(() => threads.filter((thread) => filter === "all" || thread.replyStatus === filter), [filter, threads]);
  return (
    <div className="lg:pl-80">
      <aside className="mb-5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:fixed lg:bottom-0 lg:left-0 lg:top-[57px] lg:mb-0 lg:w-72 lg:overflow-y-auto lg:rounded-none lg:border-y-0 lg:border-l-0 lg:border-r lg:shadow-none">
        <div className="px-3 pb-2 pt-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Recent threads · {visibleThreads.length}/{threads.length}</div>
        <div className="mb-3 flex flex-wrap gap-1 px-2">{(["all", "needs_reply", "waiting_reply"] as const).map((value) => <button className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${filter === value ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`} key={value} onClick={() => setFilter(value)} type="button">{value === "all" ? "全部" : value === "needs_reply" ? "待回复" : "等待对方回复"}</button>)}</div>
        <div className="space-y-1">
          {visibleThreads.map((thread) => (
            <a className="block rounded-xl bg-slate-50 px-3 py-3 hover:bg-slate-100" href={`#${thread.id}`} key={thread.id}>
              <div className="flex items-start justify-between gap-2">
                <p className="truncate text-sm font-semibold text-slate-900">{thread.displayTitle}</p>
                <span className={`h-2 w-2 shrink-0 rounded-full ${thread.manualReview ? "bg-amber-500" : "bg-emerald-500"}`} />
              </div>
              <p className="mt-1 truncate text-xs text-slate-600">{thread.recruiterName}</p>
                  <p className="mt-2 text-[11px] text-slate-400">{thread.receivedAt}</p>
              <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${thread.replyStatus === "needs_reply" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"}`}>{thread.replyStatus === "needs_reply" ? "待回复" : "等待对方回复"}</span>
            </a>
          ))}
        </div>
      </aside>

      <section className="space-y-5" aria-label="Recruiter conversations">
        {visibleThreads.map((thread) => (
          <article className="scroll-mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" id={thread.id} key={thread.id}>
            <header className="border-b border-slate-100 px-5 py-4 sm:px-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-slate-950">{thread.displayTitle}</h2>
                  <p className="mt-1 text-sm text-slate-500">{thread.recruiterName} · {thread.receivedAt}</p>
                  <StageProgress currentStage={thread.currentStage} />
                </div>
                <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${thread.manualReview ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}>
                  {thread.manualReview ? <ShieldAlert aria-hidden="true" size={14} /> : <CheckCircle2 aria-hidden="true" size={14} />}
                  {thread.manualReply ? "已人工回复" : thread.manualReview ? "需要你确认" : "Agent 可处理"}
                </span>
              </div>
            </header>

            <div className="space-y-4 p-5 sm:p-6">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400"><CircleUserRound aria-hidden="true" size={14} /> Message thread</div>
              <div className="max-h-[500px] space-y-4 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/40 p-3" tabIndex={0}>
                {thread.messages.map((message) => <Bubble key={message.id} body={message.body} label={message.label} summary={message.summary} tone={message.tone} at={message.at} replyDraft={message.replyDraft} />)}
              </div>

              <div className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-indigo-950"><Bot aria-hidden="true" size={16} /> AI summary</div>
                <p className="mt-2 text-sm leading-6 text-indigo-950">{thread.summary}</p>
              </div>

              {thread.jobs.length > 0 && <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm"><span className="font-semibold text-slate-700">Job</span>{thread.jobs.map((job) => <Link className="text-emerald-700 underline hover:text-emerald-900" href={`/jobs/${job.id}`} key={job.id}>{job.title}</Link>)}</div>}
              {thread.manualReply && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">你已在 Outlook 手动回复；状态已标记为 Contacted，Autopilot 已停止。</div>}
              {thread.pipeline ? <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950"><p className="font-semibold">Pipeline · {thread.pipeline.title ?? thread.pipeline.status}</p><p className="mt-1 text-xs">{thread.pipeline.stage ? `当前阶段：${thread.pipeline.stage}` : thread.pipeline.hold ?? `状态：${thread.pipeline.status}`}</p></div> : !thread.manualReply && thread.pipelineMessageId && (thread.jobs.length > 0 ? <form action={addExistingJobToPipeline.bind(null, thread.jobs[0]!.id, thread.pipelineMessageId)}><button className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900" type="submit">添加到 Pipeline 并生成回复草稿</button></form> : <form action={addConversationToPipeline.bind(null, thread.pipelineMessageId)}><button className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900" type="submit">添加到 Pipeline 并运行 Autopilot</button></form>)}

            </div>
          </article>
        ))}
        {!visibleThreads.length && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">当前筛选没有对话。</div>}
      </section>
    </div>
  );
}
