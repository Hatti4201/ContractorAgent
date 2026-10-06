import { getPrisma } from "@/lib/prisma";
import { ActivityType, ApplicationStage, AutoSendState } from "@/app/generated/prisma/enums";
import { outlookAccessToken } from "@/services/outlook-auth";
import { listOutlookFolderMessages, readOutlookInboxMessage, type OutlookInboxMessage, type OutlookMailFolder } from "@/services/outlook-graph";
import { summarizeConversation } from "@/services/conversation-summary";
import type { TaskHandle } from "@/services/tasks";
import { automatedSender, createIntakeFromMessage, worthClassifying } from "@/services/intake-scan";
import { runIntakePipeline } from "@/services/intake-pipeline";

const FOLDERS: OutlookMailFolder[] = ["focused", "other", "sentitems", "junkemail"];
const JOB_WORDS = /recruit|resume|cv|position|role|contract|c2c|w2|interview|submission|rate|hiring|job|onsite|remote|candidate/i;
const NON_INTERACTIVE_MESSAGE = /automated message[\s\S]{0,120}do not reply|do not reply to this email/i;

export function isInteractiveOutlookMessage(message: { fromAddress: string; subject: string; preview: string }, folder: OutlookMailFolder) {
  if (folder === "sentitems") return true;
  return !automatedSender(message.fromAddress) && !NON_INTERACTIVE_MESSAGE.test(`${message.subject} ${message.preview}`);
}

function relevant(message: OutlookInboxMessage, opportunities: { title: string; client: string | null; recruiter: { email: string | null } | null }[]) {
  const text = `${message.subject} ${message.preview}`;
  return opportunities.some((job) => job.recruiter?.email?.toLowerCase() === message.fromAddress || job.recruiter?.email?.toLowerCase() === message.toAddresses?.[0]) || JOB_WORDS.test(text);
}

function words(value: string) {
  return new Set(value.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").split(/\s+/).filter((word) => word.length > 2 && !["developer", "engineer", "role", "position", "full", "stack"].includes(word)));
}

function matchingJobs(message: OutlookInboxMessage, body: string, opportunities: { id: string; title: string; client: string | null; recruiter: { email: string | null } | null }[]) {
  const text = `${message.subject} ${body}`;
  const messageWords = words(text);
  const candidates = opportunities.map((job) => {
    const recruiterMatch = job.recruiter?.email?.toLowerCase() && [message.fromAddress, ...(message.toAddresses ?? [])].includes(job.recruiter.email.toLowerCase());
    const clientMatch = Boolean(job.client && text.toLowerCase().includes(job.client.toLowerCase()));
    const titleWords = words(job.title);
    const overlap = [...titleWords].filter((word) => messageWords.has(word)).length;
    const score = (recruiterMatch ? 100 : 0) + (clientMatch ? 20 : 0) + overlap;
    return { job, score, overlap, recruiterMatch };
  }).filter((candidate) => candidate.recruiterMatch || candidate.score >= 22 || (candidate.overlap >= 2 && candidate.overlap / Math.max(words(candidate.job.title).size, 1) >= 0.5))
    .sort((a, b) => b.score - a.score);
  const recruiterCandidates = candidates.filter((candidate) => candidate.recruiterMatch);
  if (recruiterCandidates.length) {
    if (recruiterCandidates.length === 1) return recruiterCandidates;
    return recruiterCandidates[0].score > recruiterCandidates[1].score ? recruiterCandidates.slice(0, 1) : [];
  }
  return candidates[0] && candidates[0].score > (candidates[1]?.score ?? -1) ? candidates.slice(0, 1) : [];
}

export function isManualOutlookReply(messages: { outlookMessageId: string; direction: string }[], agentMessageIds: Set<string>) {
  return messages.some((message) => message.direction === "outgoing" && !agentMessageIds.has(message.outlookMessageId));
}

function direction(folder: OutlookMailFolder) { return folder === "sentitems" ? "outgoing" : "incoming"; }

function iso(value: unknown) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

export async function syncOutlookConversations(task?: TaskHandle, forceRecent = false) {
  const database = getPrisma();
  const state = await database.mailScanState.upsert({ where: { id: "primary" }, create: { id: "primary" }, update: {} });
  const firstScan = forceRecent || !state.initialScanCompleteAt;
  const oldWatermarks = state.folderWatermarks && typeof state.folderWatermarks === "object" && !Array.isArray(state.folderWatermarks)
    ? state.folderWatermarks as Record<string, unknown> : {};
  const sinceDefault = new Date(Date.now() - 90 * 24 * 60 * 60_000);
  const accessToken = await outlookAccessToken();
  const opportunities = await database.opportunity.findMany({
    select: { id: true, title: true, client: true, recruiter: { select: { email: true } } },
  });
  const maxWatermarks: Record<string, string> = { ...Object.fromEntries(Object.entries(oldWatermarks).flatMap(([key, value]) => iso(value) ? [[key, value as string]] : [])) };
  let synced = 0;
  const touchedThreads = new Set<string>();

  for (const folder of FOLDERS) {
    await task?.progress(`Syncing Outlook ${folder}`);
    const since = firstScan ? sinceDefault : new Date(maxWatermarks[folder] ?? sinceDefault.toISOString());
    const messages = await listOutlookFolderMessages(folder, { accessToken }, since);
    for (const listed of messages) {
      const conversationKey = listed.conversationId ?? listed.id;
      const full = listed.body ? listed : await readOutlookInboxMessage(listed.id, { accessToken });
      const body = full.body?.trim() || listed.preview.trim() || "(邮件正文未同步)";
      const interactive = isInteractiveOutlookMessage({ fromAddress: listed.fromAddress, subject: listed.subject, preview: `${listed.preview} ${body}` }, folder);
      const isRelevant = interactive && relevant(listed, opportunities);
      const thread = await database.conversationThread.upsert({
        where: { outlookConversationId: conversationKey },
        create: {
          outlookConversationId: conversationKey,
          subject: listed.subject,
          recruiterName: listed.fromAddress,
          recruiterEmail: listed.fromAddress,
          isRelevant,
          isHidden: !isRelevant,
          lastMessageAt: listed.receivedAt,
        },
        update: {
          subject: listed.subject,
          recruiterName: listed.fromAddress,
          recruiterEmail: listed.fromAddress,
          ...(interactive ? { isRelevant: { set: isRelevant }, isHidden: { set: !isRelevant }, lastMessageAt: { set: listed.receivedAt > new Date(0) ? listed.receivedAt : new Date() } } : {}),
        },
      });
      touchedThreads.add(thread.id);
      const message = await database.conversationMessage.upsert({
        where: { outlookMessageId: listed.id },
        create: {
          outlookMessageId: listed.id,
          conversationId: thread.id,
          folder,
          direction: direction(folder),
          fromAddress: listed.fromAddress,
          toAddresses: (listed.toAddresses ?? []).join(", "),
          subject: listed.subject,
          body,
          bodyPreview: listed.preview || body.slice(0, 2_000),
          sentAt: listed.sentAt ?? null,
          receivedAt: listed.receivedAt,
          isRelevant,
          isHidden: !isRelevant,
          messageType: direction(folder) === "incoming" ? "recruiter_reply" : "sent",
        },
        update: {
          body,
          bodyPreview: listed.preview || body.slice(0, 2_000),
          isRelevant,
          isHidden: !isRelevant,
          folder,
          direction: direction(folder),
          sentAt: listed.sentAt ?? null,
          receivedAt: listed.receivedAt,
        },
      });
      for (const candidate of interactive ? matchingJobs(listed, body, opportunities) : []) {
        await database.conversationJob.upsert({
          where: { conversationId_opportunityId: { conversationId: thread.id, opportunityId: candidate.job.id } },
          create: { conversationId: thread.id, opportunityId: candidate.job.id },
          update: {},
        });
      }
      if (isRelevant && !message.summary) {
        const summary = await summarizeConversation({ subject: listed.subject, recruiterMessage: direction(folder) === "incoming" ? body : "", sentMessage: direction(folder) === "outgoing" ? body : null }).catch(() => null);
        if (summary) await database.conversationMessage.update({ where: { id: message.id }, data: { summary: direction(folder) === "incoming" ? summary.recruiterSummary : summary.sentSummary, replyDraft: direction(folder) === "incoming" ? summary.replyDraft : null, analyzedAt: new Date() } });
      }
      synced += 1;
      const timestamp = listed.receivedAt.toISOString();
      if (!maxWatermarks[folder] || timestamp > maxWatermarks[folder]!) maxWatermarks[folder] = timestamp;
    }
  }
  await queueUnlinkedJobs(database, touchedThreads, task);
  await applyManualReplies(database, touchedThreads);
  await database.mailScanState.update({ where: { id: "primary" }, data: { folderWatermarks: maxWatermarks, initialScanCompleteAt: state.initialScanCompleteAt ?? new Date(), lastSuccessAt: new Date(), lastError: null, errorClearedAt: null } });
  return { synced, firstScan };
}

async function queueUnlinkedJobs(database: ReturnType<typeof getPrisma>, threadIds: Set<string>, task?: TaskHandle) {
  const threads = await database.conversationThread.findMany({
    where: { id: { in: [...threadIds] }, isRelevant: true },
    include: { messages: { orderBy: { receivedAt: "desc" } }, jobs: { select: { opportunityId: true } } },
  });
  for (const thread of threads) {
    if (thread.jobs.length) continue;
    const incoming = thread.messages.find((message) => message.direction === "incoming");
    if (!incoming || !worthClassifying({ fromAddress: incoming.fromAddress, subject: incoming.subject, preview: incoming.bodyPreview })) continue;
    const existing = await database.jobIntake.findUnique({ where: { sourceMessageId: incoming.outlookMessageId }, select: { id: true } });
    if (existing) continue;
    const intake = await createIntakeFromMessage(incoming.outlookMessageId, await outlookAccessToken(), database);
    await task?.progress(`Running autopilot for ${thread.subject.slice(0, 80)}`);
    await runIntakePipeline(intake.id, task);
    const completed = await database.jobIntake.findUnique({ where: { id: intake.id }, select: { opportunityId: true } });
    if (completed?.opportunityId) await database.conversationJob.create({ data: { conversationId: thread.id, opportunityId: completed.opportunityId } }).catch(() => {});
  }
}

async function applyManualReplies(database: ReturnType<typeof getPrisma>, threadIds: Set<string>) {
  if (!threadIds.size) return;
  const threads = await database.conversationThread.findMany({
    where: { id: { in: [...threadIds] } },
    include: {
      messages: { select: { outlookMessageId: true, direction: true }, orderBy: { receivedAt: "asc" } },
      jobs: { include: { opportunity: { select: { id: true, applicationTrack: { select: { currentStage: true } } } } } },
    },
  });
  const messageIds = threads.flatMap((thread) => thread.messages.map((message) => message.outlookMessageId));
  const agentMessageIds = new Set((await database.outreachDraft.findMany({ where: { outlookMessageId: { in: messageIds } }, select: { outlookMessageId: true } })).flatMap((draft) => draft.outlookMessageId ? [draft.outlookMessageId] : []));
  for (const thread of threads) {
    if (!isManualOutlookReply(thread.messages, agentMessageIds)) continue;
    for (const { opportunity } of thread.jobs) {
      const current = opportunity.applicationTrack?.currentStage;
      if (current !== ApplicationStage.DISCOVERED && current !== ApplicationStage.OUTREACH_SENT) continue;
      await database.$transaction([
        database.applicationTrack.update({ where: { opportunityId: opportunity.id }, data: { currentStage: ApplicationStage.RECRUITER_ENGAGED, waitingOn: "Recruiter", nextAction: "Continue from your manual Outlook reply" } }),
        database.outreachDraft.updateMany({ where: { opportunityId: opportunity.id, autoSendState: AutoSendState.SCHEDULED }, data: { autoSendState: AutoSendState.CANCELLED, autoSendError: "Automatic follow-up stopped because you replied manually in Outlook." } }),
        database.activity.create({ data: { opportunityId: opportunity.id, type: ActivityType.RECRUITER_REPLY, description: "Manual Outlook reply detected; job marked Contacted and autopilot stopped." } }),
      ]);
    }
  }
}
