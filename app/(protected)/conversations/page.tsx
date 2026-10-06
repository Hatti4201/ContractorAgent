import Link from "next/link";
import { Mail, Pause, RefreshCw } from "lucide-react";
import { TaskKind, TaskStatus } from "@/app/generated/prisma/enums";
import { ConversationThreads, type ConversationThread } from "@/components/conversation-threads";
import { requireAuth } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/job-values";
import { setConversationScanEnabled, syncConversationsAction } from "./actions";

function displayJobTitle(titles: string[], subject: string) {
  const unique = [...new Set(titles.map((title) => title.trim()).filter(Boolean))];
  return unique.slice(0, 2).join(" / ") || subject;
}

export default async function ConversationsPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  await requireAuth();
  const showAll = (await searchParams).all === "1";
  const database = getPrisma();
  const [state, rows, runningTask] = await Promise.all([
    database.mailScanState.upsert({ where: { id: "primary" }, create: { id: "primary" }, update: {} }),
    database.conversationThread.findMany({ where: showAll ? {} : { isRelevant: true, isHidden: false, messages: { some: { isHidden: false } } }, include: { messages: { where: { isHidden: false }, orderBy: { receivedAt: "asc" } }, jobs: { orderBy: { createdAt: "desc" }, take: 1, include: { opportunity: { select: { id: true, title: true } } } } }, orderBy: { lastMessageAt: "desc" }, take: 50 }),
    database.task.findFirst({ where: { kind: TaskKind.FOLLOW_UP_SCAN, subjectId: { in: ["conversation-sync", "follow-up-scan"] }, status: TaskStatus.RUNNING }, select: { id: true, progress: true } }),
  ]);
  const messageIds = rows.flatMap((row) => row.messages.map((message) => message.outlookMessageId));
  const intakes = messageIds.length ? await database.jobIntake.findMany({ where: { sourceMessageId: { in: messageIds } }, select: { id: true, sourceMessageId: true, status: true, preview: true, opportunity: { select: { title: true, applicationTrack: { select: { currentStage: true } } } } } }) : [];
  const intakeByMessage = new Map(intakes.map((intake) => [intake.sourceMessageId, intake]));
  const agentMessageIds = new Set((messageIds.length ? await database.outreachDraft.findMany({ where: { outlookMessageId: { in: messageIds } }, select: { outlookMessageId: true } }) : []).flatMap((draft) => draft.outlookMessageId ? [draft.outlookMessageId] : []));
  const threads: ConversationThread[] = rows.map((row) => ({
    id: row.id, recruiterName: row.recruiterName ?? row.recruiterEmail ?? "Unknown recruiter", subject: row.subject,
    displayTitle: displayJobTitle(row.jobs.map((job) => job.opportunity.title), row.subject), receivedAt: formatDateTime(row.lastMessageAt), currentStage: "RECRUITER_ENGAGED",
    manualReply: row.messages.some((message) => message.direction === "outgoing" && !agentMessageIds.has(message.outlookMessageId)),
    replyStatus: row.messages.some((message) => message.direction === "outgoing" && !agentMessageIds.has(message.outlookMessageId)) ? "waiting_reply" as const : row.messages.at(-1)?.direction === "incoming" ? "needs_reply" as const : "waiting_reply" as const,
    manualReview: row.messages.some((message) => /rtr|right to represent|rate|commit/i.test(`${message.subject} ${message.body}`)), summary: row.summary ?? "Recruiter conversation · 待处理",
    jobs: row.jobs.map((job) => ({ id: job.opportunity.id, title: job.opportunity.title })),
    pipelineMessageId: row.messages.findLast((message) => message.direction === "incoming")?.id ?? null,
    pipeline: row.messages.map((message) => intakeByMessage.get(message.outlookMessageId)).find(Boolean) ? (() => { const intake = row.messages.map((message) => intakeByMessage.get(message.outlookMessageId)).find(Boolean)!; const preview = intake.preview && typeof intake.preview === "object" && !Array.isArray(intake.preview) ? intake.preview as { hold?: unknown } : null; return { id: intake.id, status: intake.status, title: intake.opportunity?.title ?? null, stage: intake.opportunity?.applicationTrack?.currentStage ?? null, hold: typeof preview?.hold === "string" ? preview.hold : null }; })() : null,
    messages: row.messages.map((message) => ({ id: message.id, label: message.direction === "incoming" ? row.recruiterName ?? "Recruiter" : "Hatti Ma", body: message.body, summary: message.summary ?? message.bodyPreview, tone: message.direction === "incoming" ? "incoming" as const : "outgoing" as const, at: formatDateTime(message.receivedAt), replyDraft: message.replyDraft })),
  }));
  return <div className="mx-auto max-w-7xl px-6 py-10">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Recruiter inbox</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Conversations</h1><p className="mt-2 max-w-2xl text-slate-600">Outlook 负责收发；这里显示 recruiter/job 对话和 Agent 摘要。</p></div>
      <div className="flex flex-wrap gap-2">{runningTask ? <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800"><RefreshCw className="animate-spin" size={15} />Scanning{runningTask.progress ? ` · ${runningTask.progress}` : "..."}<form action={setConversationScanEnabled}><input type="hidden" name="enabled" value="false" /><button className="ml-2 inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-white px-2 py-1 text-xs font-semibold text-emerald-800" type="submit"><Pause size={13} />Pause</button></form></div> : <form action={syncConversationsAction}><button className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-200" type="submit"><RefreshCw size={15} />Scan now</button></form>}<Link className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700" href="/outlook"><Mail size={15} />Outlook</Link></div>
    </div>
    <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-500"><span className={state.autoScanEnabled ? "font-semibold text-emerald-700" : "font-semibold text-amber-700"}>{state.autoScanEnabled ? "● Running · every 5 min" : "● Paused"}</span>{state.lastSuccessAt && <span>Last sync {formatDateTime(state.lastSuccessAt)}</span>}<Link className="text-blue-700 hover:underline" href={showAll ? "/conversations" : "/conversations?all=1"}>{showAll ? "Hide non-recruiter mail" : "Show hidden mail"}</Link></div>
    <div className="mt-8"><ConversationThreads threads={threads} /></div>
  </div>;
}
