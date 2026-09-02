import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { OutreachMode } from "@/app/generated/prisma/enums";
import { outreachBodyHtml } from "@/services/outreach-markup";
import { checkResumeFile } from "@/services/resume-router";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
export const SIMPLE_ATTACHMENT_LIMIT = 3 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 150 * 1024 * 1024;
const UPLOAD_CHUNK_BYTES = 12 * 320 * 1024;
export const replyModes = new Set<OutreachMode>([OutreachMode.DIRECT_EMAIL_REPLY, OutreachMode.THREAD_FOLLOW_UP]);

type FetchOptions = { accessToken: string; fetcher?: typeof fetch };
export type OutlookInboxMessage = {
  id: string;
  subject: string;
  preview: string;
  fromAddress: string;
  receivedAt: Date;
};
type GraphDraftInput = {
  mode: OutreachMode;
  toAddress: string;
  ccAddress: string | null;
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

/** A webLink is only followed when it really is an Outlook address over https. */
export function safeOutlookLink(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["outlook.office.com", "outlook.office365.com", "outlook.live.com"].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)) ? value : null;
  } catch { return null; }
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

async function attachmentBytes(messageIdValue: string, attachmentId: string, options: FetchOptions) {
  const response = await (options.fetcher ?? fetch)(`${GRAPH_BASE_URL}/me/messages/${encodeURIComponent(messageIdValue)}/attachments/${encodeURIComponent(attachmentId)}/$value`, {
    method: "GET",
    headers: { Authorization: `Bearer ${options.accessToken}`, Prefer: 'IdType="ImmutableId"' },
    signal: AbortSignal.timeout(60_000),
  });
  if (response.status !== 200) throw new OutlookGraphError(response.status);
  return Buffer.from(await response.arrayBuffer());
}

function messageId(value: unknown) {
  const message = object(value);
  return { id: requiredString(message.id, "message id"), webLink: typeof message.webLink === "string" ? message.webLink : null };
}

function recipient(address: string) {
  return [{ emailAddress: { address } }];
}

function recipientFields(input: GraphDraftInput) {
  return {
    toRecipients: recipient(input.toAddress),
    // Always sent, so clearing the copy on a reply draft actually removes the inherited one.
    ccRecipients: input.ccAddress ? recipient(input.ccAddress) : [],
  };
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
  const value = object(await graphRequest(`/me/messages/${encodeURIComponent(messageIdValue)}/attachments?$select=id,name,size,isInline`, { method: "GET" }, options, [200]));
  if (!Array.isArray(value.value)) throw new Error("Microsoft Graph attachment response is invalid.");
  return value.value.map((item) => {
    const attachment = object(item);
    return { id: typeof attachment.id === "string" && attachment.id ? attachment.id : null, name: requiredString(attachment.name, "attachment name", 500), size: Number(attachment.size), isInline: attachment.isInline === true };
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
        body: JSON.stringify({ subject: input.subject, body: { contentType: "HTML", content: outreachBodyHtml(input.body) }, ...recipientFields(input) }),
      }, options, [200]);
    } else {
      created = messageId(await graphRequest("/me/messages", {
        method: "POST",
        body: JSON.stringify({ subject: input.subject, body: { contentType: "HTML", content: outreachBodyHtml(input.body) }, ...recipientFields(input) }),
      }, options, [201]));
    }

    await addAttachment(created.id, fileName, content, options);
    const message = object(await graphRequest(`/me/messages/${encodeURIComponent(created.id)}?$select=id,isDraft,webLink,toRecipients,ccRecipients,subject,hasAttachments`, { method: "GET" }, options, [200]));
    const recipients = Array.isArray(message.toRecipients) ? message.toRecipients : [];
    const actualRecipient = recipients.length === 1 ? object(object(recipients[0]).emailAddress).address : null;
    const attachments = await attachmentMetadata(created.id, options);
    const verificationIssues: string[] = [];
    if (message.isDraft !== true) verificationIssues.push("Outlook did not keep the item as a draft.");
    if (message.subject !== input.subject) verificationIssues.push("Subject verification failed: Outlook changed or omitted the subject.");
    if (recipients.length !== 1) verificationIssues.push(`Recipient verification failed: expected exactly 1 recipient, Outlook returned ${recipients.length}.`);
    if (typeof actualRecipient !== "string") verificationIssues.push("Recipient verification failed: Outlook returned no readable recipient address.");
    else if (actualRecipient.toLowerCase() !== input.toAddress.toLowerCase()) verificationIssues.push("Recipient verification failed: Outlook recipient differs from the confirmed recipient.");
    const copies = Array.isArray(message.ccRecipients) ? message.ccRecipients : [];
    const copyValue = copies.length === 1 ? object(object(copies[0]).emailAddress).address : null;
    const actualCopy = typeof copyValue === "string" ? copyValue : null;
    if (input.ccAddress && (copies.length !== 1 || actualCopy?.toLowerCase() !== input.ccAddress.toLowerCase())) {
      verificationIssues.push(`Copy verification failed: expected exactly ${input.ccAddress} on cc, Outlook returned ${copies.length} address(es).`);
    }
    if (!input.ccAddress && copies.length) verificationIssues.push(`Copy verification failed: Outlook added ${copies.length} unexpected cc address(es).`);
    if (message.hasAttachments !== true) verificationIssues.push("Attachment verification failed: Outlook reports no attachment on the draft.");
    if (!attachments.length) verificationIssues.push("Attachment verification failed: Outlook returned no attachment metadata.");
    const namedAttachments = attachments.filter((attachment) => attachment.name === fileName);
    if (!namedAttachments.length) verificationIssues.push(`Attachment verification failed: expected file "${fileName}" was not found.`);
    else if (!namedAttachments.some((attachment) => !attachment.isInline)) verificationIssues.push(`Attachment verification failed: file "${fileName}" is marked inline instead of a file attachment.`);
    const exactAttachment = namedAttachments.find((attachment) => !attachment.isInline && attachment.size === content.length);
    let verificationWarning: string | null = null;
    if (!exactAttachment) {
      const sizes = namedAttachments.filter((attachment) => !attachment.isInline).map((attachment) => Number.isFinite(attachment.size) ? `${attachment.size} bytes` : "unknown size").join(", ");
      const contentAttachment = namedAttachments.find((attachment) => !attachment.isInline);
      if (!contentAttachment) verificationIssues.push(`Attachment verification failed: "${fileName}" is not a file attachment.`);
      else if (!contentAttachment.id) verificationIssues.push(`Attachment verification failed: Outlook did not return an attachment id for "${fileName}"; retry the draft creation.`);
      else {
        const localHash = createHash("sha256").update(content).digest("hex");
        const outlookHash = createHash("sha256").update(await attachmentBytes(created.id, contentAttachment.id, options)).digest("hex");
        if (localHash !== outlookHash) verificationIssues.push(`Attachment verification failed: "${fileName}" content differs (expected ${content.length} bytes; Outlook returned ${sizes || "no readable size"}).`);
        else verificationWarning = `Attachment size metadata differs (expected ${content.length} bytes; Outlook returned ${sizes || "no readable size"}), but SHA-256 content matches.`;
      }
    }
    if (verificationIssues.length) throw new Error(verificationIssues.join(" "));
    return { id: created.id, webLink: typeof message.webLink === "string" ? message.webLink : created.webLink, attachmentName: fileName, attachmentSize: content.length, verificationWarning };
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

function inboxMessage(value: unknown): OutlookInboxMessage {
  const message = object(value);
  const from = object(object(message.from).emailAddress);
  if (message.isDraft !== false) throw new Error("Microsoft Graph returned an invalid Inbox message.");
  const receivedAt = new Date(requiredString(message.receivedDateTime, "received date", 100));
  if (Number.isNaN(receivedAt.getTime())) throw new Error("Microsoft Graph received date is invalid.");
  return {
    id: requiredString(message.id, "message id"),
    subject: typeof message.subject === "string" && message.subject ? message.subject.slice(0, 500) : "(No subject)",
    preview: typeof message.bodyPreview === "string" ? message.bodyPreview.slice(0, 2_000) : "",
    fromAddress: requiredString(from.address, "sender address", 320).toLowerCase(),
    receivedAt,
  };
}

/**
 * Without a watermark this returns the newest messages; with one it returns the oldest messages that
 * arrived after it, so repeated scans walk forward through the mailbox and cannot skip a run's worth.
 */
export async function listOutlookInboxMessages(options: FetchOptions, since?: Date | null) {
  const select = "$select=id,subject,bodyPreview,receivedDateTime,from,isDraft&$top=25";
  const path = since
    ? `/me/mailFolders/inbox/messages?${select}&$orderby=receivedDateTime%20asc&$filter=receivedDateTime%20gt%20${encodeURIComponent(since.toISOString())}`
    : `/me/mailFolders/inbox/messages?${select}&$orderby=receivedDateTime%20desc`;
  const result = object(await graphRequest(path, { method: "GET" }, options, [200]));
  if (!Array.isArray(result.value)) throw new Error("Microsoft Graph message list is invalid.");
  const messages = result.value.flatMap((value) => {
    try { return [inboxMessage(value)]; } catch { return []; }
  });
  return since ? messages : messages.reverse();
}

export async function getOutlookInboxMessage(messageIdValue: string, options: FetchOptions) {
  const path = `/me/messages/${encodeURIComponent(messageIdValue)}?$select=id,subject,bodyPreview,receivedDateTime,from,isDraft`;
  return inboxMessage(await graphRequest(path, { method: "GET" }, options, [200]));
}

export async function listOutlookSourceMessages(recruiterEmail: string, options: FetchOptions) {
  return (await listOutlookInboxMessages(options))
    .filter((message) => message.fromAddress === recruiterEmail.toLowerCase())
    .slice(0, 10)
    .map((message) => ({ id: message.id, subject: message.subject, receivedDateTime: message.receivedAt.toISOString() }));
}

export async function validateOutlookSourceMessage(messageIdValue: string, recruiterEmail: string, options: FetchOptions) {
  const message = object(await graphRequest(`/me/messages/${encodeURIComponent(messageIdValue)}?$select=id,subject,receivedDateTime,from,isDraft`, { method: "GET" }, options, [200]));
  const from = object(object(message.from).emailAddress);
  if (message.isDraft === true || typeof from.address !== "string" || from.address.toLowerCase() !== recruiterEmail.toLowerCase()) {
    throw new Error("Selected Outlook message is not an incoming message from the confirmed Recruiter.");
  }
  return requiredString(message.id, "message id");
}

export type SentMessageArchive = {
  sent: true;
  sentAt: Date;
  subject: string;
  body: string;
  toAddress: string;
  differences: string[];
};

/** A size mismatch alone proves nothing: Outlook reports the MIME-encoded size on sent mail. */
async function sentAttachmentMatches(messageIdValue: string, fileName: string, content: Buffer, options: FetchOptions) {
  const candidates = (await attachmentMetadata(messageIdValue, options)).filter((attachment) => !attachment.isInline && attachment.name === fileName);
  if (!candidates.length) return false;
  if (candidates.some((attachment) => attachment.size === content.length)) return true;
  const identified = candidates.find((attachment) => attachment.id)?.id;
  if (!identified) return false;
  const localHash = createHash("sha256").update(content).digest("hex");
  const outlookHash = createHash("sha256").update(await attachmentBytes(messageIdValue, identified, options)).digest("hex");
  return localHash === outlookHash;
}

/**
 * Reports what Outlook actually sent, so the user's own edits can be archived as the record of truth.
 * Differences are described, never used to reject the message.
 */
export async function inspectOutlookSentMessage(messageIdValue: string, expected: { toAddress: string; subject: string; resumePath: string }, options: FetchOptions): Promise<SentMessageArchive | { sent: false; sentAt: null }> {
  const checked = await checkResumeFile(expected.resumePath);
  if (!checked.usable || !checked.canonicalPath) throw new Error(checked.issue ?? "Selected Resume is unavailable.");
  const content = await readFile(checked.canonicalPath);
  const fileName = basename(checked.canonicalPath);
  const message = object(await graphRequest(`/me/messages/${encodeURIComponent(messageIdValue)}?$select=id,isDraft,sentDateTime,toRecipients,subject,body,hasAttachments`, {
    method: "GET",
    // Plain text keeps the archived copy readable; the reply history Outlook appends is part of what was sent.
    headers: { Prefer: 'IdType="ImmutableId", outlook.body-content-type="text"' },
  }, options, [200]));
  if (message.isDraft === true || typeof message.sentDateTime !== "string") return { sent: false as const, sentAt: null };
  const sentAt = new Date(message.sentDateTime);
  if (Number.isNaN(sentAt.getTime())) throw new Error("Microsoft Graph sent time is invalid.");

  const recipients = (Array.isArray(message.toRecipients) ? message.toRecipients : [])
    .map((entry) => object(object(entry).emailAddress).address)
    .filter((address): address is string => typeof address === "string" && Boolean(address));
  const subject = typeof message.subject === "string" ? message.subject.slice(0, 300) : "";
  const bodyValue = message.body && typeof message.body === "object" ? object(message.body).content : null;
  const body = typeof bodyValue === "string" ? bodyValue.slice(0, 100_000) : "";
  const attachmentMatches = message.hasAttachments === true && await sentAttachmentMatches(messageIdValue, fileName, content, options);

  const differences: string[] = [];
  if (recipients.length !== 1 || recipients[0]!.toLowerCase() !== expected.toAddress.toLowerCase()) differences.push("recipient");
  if (subject !== expected.subject) differences.push("subject");
  if (!attachmentMatches) differences.push("attachment");
  return { sent: true as const, sentAt, subject, body, toAddress: recipients.join(", ").slice(0, 1_000), differences };
}
