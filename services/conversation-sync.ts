import { getPrisma } from "@/lib/prisma";
import { outlookAccessToken } from "@/services/outlook-auth";
import { listOutlookFolderMessages, readOutlookInboxMessage, type OutlookInboxMessage, type OutlookMailFolder } from "@/services/outlook-graph";
import { stopAutomaticSendAfterManualReply } from "@/services/manual-reply";
import { summarizeConversation } from "@/services/conversation-summary";
import type { TaskHandle } from "@/services/tasks";
import { automatedSender, createIntakeFromMessage, worthClassifying } from "@/services/intake-scan";
import { runIntakePipeline } from "@/services/intake-pipeline";
import { isAiCapacityError } from "@/services/ai-capacity";

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

function normalizedSubject(value: string) {
  return value.toLowerCase().replace(/^(?:re|fw|fwd)\s*:\s*/gi, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Merges split Outlook threads from one recruiter/job without trusting conversationId alone. */
export async function mergeConversationThreads(database: ReturnType<typeof getPrisma>, since: Date) {
  const threads = await database.conversationThread.findMany({
    where: { isRelevant: true, lastMessageAt: { gte: since } },
    include: {
      messages: { select: { fromAddress: true, toAddresses: true, subject: true, receivedAt: true }, orderBy: { receivedAt: "asc" } },
      jobs: { include: { opportunity: { select: { id: true, recruiter: { select: { email: true } } } } } },
    },
    orderBy: { createdAt: "asc" },
  });
  const groups = new Map<string, typeof threads>();
  for (const thread of threads) {
    const recruiterEmails = new Set(thread.jobs.flatMap((job) => job.opportunity.recruiter?.email ? [job.opportunity.recruiter.email.toLowerCase()] : []));
    for (const message of thread.messages) {
      if (message.fromAddress) recruiterEmails.add(message.fromAddress.toLowerCase());
      for (const address of message.toAddresses.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean)) recruiterEmails.add(address);
    }
    const jobKeys = thread.jobs.map((job) => job.opportunity.recruiter?.email ? `${job.opportunity.id}:${job.opportunity.recruiter.email.toLowerCase()}` : null).filter(Boolean);
    const key = `${jobKeys.sort().join("|") || [...recruiterEmails].sort().join("|")}::${normalizedSubject(thread.subject)}`;
    if (!key.startsWith("::") && !key.endsWith("::")) groups.set(key, [...(groups.get(key) ?? []), thread]);
  }
  const merged = new Set<string>();
  for (const group of groups.values()) {
    if (group.length < 2) { merged.add(group[0]!.id); continue; }
    const canonical = group[0]!;
    for (const duplicate of group.slice(1)) {
      await database.$transaction(async (transaction) => {
        for (const job of duplicate.jobs) {
          await transaction.conversationJob.upsert({
            where: { conversationId_opportunityId: { conversationId: canonical.id, opportunityId: job.opportunity.id } },
            create: { conversationId: canonical.id, opportunityId: job.opportunity.id },
            update: {},
          });
        }
        await transaction.conversationMessage.updateMany({ where: { conversationId: duplicate.id }, data: { conversationId: canonical.id } });
        await transaction.conversationThread.update({ where: { id: canonical.id }, data: { lastMessageAt: duplicate.lastMessageAt > canonical.lastMessageAt ? duplicate.lastMessageAt : canonical.lastMessageAt, isRelevant: true, isHidden: false } });
        await transaction.conversationThread.delete({ where: { id: duplicate.id } });
      });
    }
    merged.add(canonical.id);
  }
  return merged;
}

export async function syncOutlookConversations(task?: TaskHandle, forceRecent = false, sinceOverride?: Date) {
  const database = getPrisma();
  const state = await database.mailScanState.upsert({ where: { id: "primary" }, create: { id: "primary" }, update: {} });
  const firstScan = forceRecent || !state.initialScanCompleteAt;
  const oldWatermarks = state.folderWatermarks && typeof state.folderWatermarks === "object" && !Array.isArray(state.folderWatermarks)
    ? state.folderWatermarks as Record<string, unknown> : {};
  const sinceDefault = sinceOverride ?? new Date(Date.now() - 90 * 24 * 60 * 60_000);
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
      const recruiterAddress = folder === "sentitems" ? (listed.toAddresses?.[0] ?? listed.fromAddress) : listed.fromAddress;
      const interactive = isInteractiveOutlookMessage({ fromAddress: listed.fromAddress, subject: listed.subject, preview: `${listed.preview} ${body}` }, folder);
      const isRelevant = interactive && relevant(listed, opportunities);
      const thread = await database.conversationThread.upsert({
        where: { outlookConversationId: conversationKey },
        create: {
          outlookConversationId: conversationKey,
          subject: listed.subject,
          recruiterName: recruiterAddress,
          recruiterEmail: recruiterAddress,
          isRelevant,
          isHidden: !isRelevant,
          lastMessageAt: listed.receivedAt,
        },
        update: {
          subject: listed.subject,
          ...(folder === "sentitems" ? {} : { recruiterName: listed.fromAddress, recruiterEmail: listed.fromAddress }),
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
        const summary = await summarizeConversation({ subject: listed.subject, recruiterMessage: direction(folder) === "incoming" ? body : "", sentMessage: direction(folder) === "outgoing" ? body : null }).catch((error) => {
          if (isAiCapacityError(error)) throw error;
          return null;
        });
        if (summary) await database.conversationMessage.update({ where: { id: message.id }, data: { summary: direction(folder) === "incoming" ? summary.recruiterSummary : summary.sentSummary, replyDraft: direction(folder) === "incoming" ? summary.replyDraft : null, analyzedAt: new Date() } });
      }
      synced += 1;
      const timestamp = listed.receivedAt.toISOString();
      if (!maxWatermarks[folder] || timestamp > maxWatermarks[folder]!) maxWatermarks[folder] = timestamp;
    }
  }
  const mergedThreads = await mergeConversationThreads(database, new Date(Date.now() - 7 * 24 * 60 * 60_000));
  for (const id of mergedThreads) touchedThreads.add(id);
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
      jobs: { include: { opportunity: { select: { id: true } } } },
    },
  });
  const messageIds = threads.flatMap((thread) => thread.messages.map((message) => message.outlookMessageId));
  const agentMessageIds = new Set((await database.outreachDraft.findMany({ where: { outlookMessageId: { in: messageIds } }, select: { outlookMessageId: true } })).flatMap((draft) => draft.outlookMessageId ? [draft.outlookMessageId] : []));
  for (const thread of threads) {
    if (!isManualOutlookReply(thread.messages, agentMessageIds)) continue;
    for (const { opportunity } of thread.jobs) {
      await stopAutomaticSendAfterManualReply(opportunity.id, database);
    }
  }
}
