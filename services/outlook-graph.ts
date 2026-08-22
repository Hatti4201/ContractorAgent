import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { OutreachMode } from "@/app/generated/prisma/enums";
import { checkResumeFile } from "@/services/resume-router";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
const SIMPLE_ATTACHMENT_LIMIT = 3 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 150 * 1024 * 1024;
const UPLOAD_CHUNK_BYTES = 12 * 320 * 1024;
const replyModes = new Set<OutreachMode>([OutreachMode.DIRECT_EMAIL_REPLY, OutreachMode.THREAD_FOLLOW_UP]);

type FetchOptions = { accessToken: string; fetcher?: typeof fetch };
type GraphDraftInput = {
  mode: OutreachMode;
  toAddress: string;
  subject: string;
  body: string;
  replySourceMessageId: string | null;
  resumePath: string;
};

export class OutlookDraftCreationError extends Error {
  constructor(message: string, readonly orphanedMessageId: string | null = null, readonly orphanedWebLink: string | null = null) {
    super(message);
  }
}

export class OutlookGraphError extends Error {
  constructor(readonly status: number) {
    super(`Microsoft Graph request failed with status ${status}.`);
  }
}

function object(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Microsoft Graph returned an invalid response.");
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, name: string, maximum = 20_000) {
  if (typeof value !== "string" || !value || value.length > maximum) throw new Error(`Microsoft Graph ${name} is invalid.`);
  return value;
}

async function graphRequest(path: string, init: RequestInit, options: FetchOptions, expected: number[]) {
  const response = await (options.fetcher ?? fetch)(`${GRAPH_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      Prefer: 'IdType="ImmutableId"',
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!expected.includes(response.status)) throw new OutlookGraphError(response.status);
  return response.status === 204 || response.status === 404 ? null : await response.json() as unknown;
}

function messageId(value: unknown) {
  const message = object(value);
  return { id: requiredString(message.id, "message id"), webLink: typeof message.webLink === "string" ? message.webLink : null };
}

function recipient(address: string) {
  return [{ emailAddress: { address } }];
}

async function addAttachment(messageIdValue: string, fileName: string, content: Buffer, options: FetchOptions) {
  const encodedMessageId = encodeURIComponent(messageIdValue);
  if (content.length < SIMPLE_ATTACHMENT_LIMIT) {
    await graphRequest(`/me/messages/${encodedMessageId}/attachments`, {
      method: "POST",
      body: JSON.stringify({ "@odata.type": "#microsoft.graph.fileAttachment", name: fileName, contentBytes: content.toString("base64") }),
    }, options, [201]);
    return;
  }

  const sessionValue = await graphRequest(`/me/messages/${encodedMessageId}/attachments/createUploadSession`, {
    method: "POST",
    body: JSON.stringify({ AttachmentItem: { attachmentType: "file", name: fileName, size: content.length } }),
  }, options, [201]);
  const uploadUrl = requiredString(object(sessionValue).uploadUrl, "upload URL", 100_000);
  const uploadTarget = new URL(uploadUrl);
  if (uploadTarget.protocol !== "https:" || (uploadTarget.hostname !== "outlook.office.com" && !uploadTarget.hostname.endsWith(".outlook.office.com"))) {
    throw new Error("Microsoft Graph returned an unsafe attachment upload URL.");
  }
  for (let start = 0; start < content.length; start += UPLOAD_CHUNK_BYTES) {
    const chunk = content.subarray(start, Math.min(start + UPLOAD_CHUNK_BYTES, content.length));
    const response = await (options.fetcher ?? fetch)(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(chunk.length),
        "Content-Range": `bytes ${start}-${start + chunk.length - 1}/${content.length}`,
      },
      body: Uint8Array.from(chunk),
      signal: AbortSignal.timeout(60_000),
    });
    if (![200, 201, 202].includes(response.status)) throw new Error(`Microsoft Graph attachment upload failed with status ${response.status}.`);
  }
}

async function attachmentMetadata(messageIdValue: string, options: FetchOptions) {
  const value = object(await graphRequest(`/me/messages/${encodeURIComponent(messageIdValue)}/attachments?$select=name,size,isInline`, { method: "GET" }, options, [200]));
  if (!Array.isArray(value.value)) throw new Error("Microsoft Graph attachment response is invalid.");
  return value.value.map((item) => {
    const attachment = object(item);
    return { name: requiredString(attachment.name, "attachment name", 500), size: Number(attachment.size), isInline: attachment.isInline === true };
  });
}

async function deleteMessage(messageIdValue: string, options: FetchOptions) {
  await graphRequest(`/me/messages/${encodeURIComponent(messageIdValue)}`, { method: "DELETE" }, options, [204, 404]);
}

export async function removeOutlookDraftMessage(messageIdValue: string, options: FetchOptions) {
  await deleteMessage(messageIdValue, options);
}

export async function createOutlookMessageDraft(input: GraphDraftInput, options: FetchOptions) {
  const checked = await checkResumeFile(input.resumePath);
  if (!checked.usable || !checked.canonicalPath) throw new OutlookDraftCreationError(checked.issue ?? "Selected Resume is unavailable.");
  const content = await readFile(checked.canonicalPath);
  if (!content.length || content.length > MAX_ATTACHMENT_BYTES) throw new OutlookDraftCreationError("Selected Resume must be between 1 byte and 150 MB.");
  const fileName = basename(checked.canonicalPath);
  let created: { id: string; webLink: string | null } | null = null;

  try {
    if (replyModes.has(input.mode)) {
      if (!input.replySourceMessageId) throw new Error("Select the original Outlook message before creating a reply draft.");
      const sourceMessageId = await validateOutlookSourceMessage(input.replySourceMessageId, input.toAddress, options);
      created = messageId(await graphRequest(`/me/messages/${encodeURIComponent(sourceMessageId)}/createReply`, { method: "POST" }, options, [200, 201]));
      await graphRequest(`/me/messages/${encodeURIComponent(created.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ subject: input.subject, body: { contentType: "Text", content: input.body }, toRecipients: recipient(input.toAddress) }),
      }, options, [200]);
    } else {
      created = messageId(await graphRequest("/me/messages", {
        method: "POST",
        body: JSON.stringify({ subject: input.subject, body: { contentType: "Text", content: input.body }, toRecipients: recipient(input.toAddress) }),
      }, options, [201]));
    }

    await addAttachment(created.id, fileName, content, options);
    const message = object(await graphRequest(`/me/messages/${encodeURIComponent(created.id)}?$select=id,isDraft,webLink,toRecipients,subject,hasAttachments`, { method: "GET" }, options, [200]));
    const recipients = Array.isArray(message.toRecipients) ? message.toRecipients : [];
    const actualRecipient = recipients.length === 1 ? object(object(recipients[0]).emailAddress).address : null;
    const attachments = await attachmentMetadata(created.id, options);
    const attachmentMatches = attachments.some((attachment) => !attachment.isInline && attachment.name === fileName && attachment.size === content.length);
    if (message.isDraft !== true || message.subject !== input.subject || typeof actualRecipient !== "string" || actualRecipient.toLowerCase() !== input.toAddress.toLowerCase() || message.hasAttachments !== true || !attachmentMatches) {
      throw new Error("Created Outlook draft did not pass recipient and attachment verification.");
    }
    return { id: created.id, webLink: typeof message.webLink === "string" ? message.webLink : created.webLink, attachmentName: fileName, attachmentSize: content.length };
  } catch (error) {
    if (!created) throw new OutlookDraftCreationError(error instanceof Error ? error.message : "Outlook draft creation failed.");
    try {
      await deleteMessage(created.id, options);
      throw new OutlookDraftCreationError(error instanceof Error ? error.message : "Outlook draft creation failed.");
    } catch (cleanupError) {
      if (cleanupError instanceof OutlookDraftCreationError) throw cleanupError;
      throw new OutlookDraftCreationError("An incomplete Outlook draft could not be removed; review it in Outlook.", created.id, created.webLink);
    }
  }
}

export async function listOutlookSourceMessages(recruiterEmail: string, options: FetchOptions) {
  // ponytail: recent Inbox mail covers active recruiting threads; add paging only when an older real thread is missed.
  const path = "/me/mailFolders/inbox/messages?$select=id,subject,receivedDateTime,from,isDraft&$top=50&$orderby=receivedDateTime%20desc";
  const result = object(await graphRequest(path, { method: "GET" }, options, [200]));
  if (!Array.isArray(result.value)) throw new Error("Microsoft Graph message list is invalid.");
  return result.value.flatMap((value) => {
    try {
      const message = object(value);
      const from = object(object(message.from).emailAddress);
      if (message.isDraft === true || typeof from.address !== "string" || from.address.toLowerCase() !== recruiterEmail.toLowerCase()) return [];
      const receivedAt = new Date(requiredString(message.receivedDateTime, "received date", 100));
      if (Number.isNaN(receivedAt.getTime())) return [];
      return [{
        id: requiredString(message.id, "message id"),
        subject: typeof message.subject === "string" && message.subject ? message.subject.slice(0, 300) : "(No subject)",
        receivedDateTime: receivedAt.toISOString(),
      }];
    } catch { return []; }
  }).slice(0, 10);
}

export async function validateOutlookSourceMessage(messageIdValue: string, recruiterEmail: string, options: FetchOptions) {
  const message = object(await graphRequest(`/me/messages/${encodeURIComponent(messageIdValue)}?$select=id,subject,receivedDateTime,from,isDraft`, { method: "GET" }, options, [200]));
  const from = object(object(message.from).emailAddress);
  if (message.isDraft === true || typeof from.address !== "string" || from.address.toLowerCase() !== recruiterEmail.toLowerCase()) {
    throw new Error("Selected Outlook message is not an incoming message from the confirmed Recruiter.");
  }
  return requiredString(message.id, "message id");
}

export async function inspectOutlookSentMessage(messageIdValue: string, expected: { toAddress: string; subject: string; resumePath: string }, options: FetchOptions) {
  const checked = await checkResumeFile(expected.resumePath);
  if (!checked.usable || !checked.canonicalPath) throw new Error(checked.issue ?? "Selected Resume is unavailable.");
  const content = await readFile(checked.canonicalPath);
  const fileName = basename(checked.canonicalPath);
  const message = object(await graphRequest(`/me/messages/${encodeURIComponent(messageIdValue)}?$select=id,isDraft,sentDateTime,toRecipients,subject,hasAttachments`, { method: "GET" }, options, [200]));
  if (message.isDraft === true || typeof message.sentDateTime !== "string") return { sent: false as const, matchesApprovedRouting: false, sentAt: null };
  const recipients = Array.isArray(message.toRecipients) ? message.toRecipients : [];
  const actualRecipient = recipients.length === 1 ? object(object(recipients[0]).emailAddress).address : null;
  const attachments = await attachmentMetadata(messageIdValue, options);
  const attachmentMatches = attachments.some((attachment) => !attachment.isInline && attachment.name === fileName && attachment.size === content.length);
  const sentAt = new Date(message.sentDateTime);
  if (Number.isNaN(sentAt.getTime())) throw new Error("Microsoft Graph sent time is invalid.");
  return {
    sent: true as const,
    matchesApprovedRouting: typeof actualRecipient === "string" && actualRecipient.toLowerCase() === expected.toAddress.toLowerCase() && message.subject === expected.subject && message.hasAttachments === true && attachmentMatches,
    sentAt,
  };
}
