import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Prisma } from "@/app/generated/prisma/client";
import { McpEventDeliveryStatus, TaskStatus } from "@/app/generated/prisma/enums";
import { getPrisma } from "@/lib/prisma";
import { runPendingAiIncidentDiagnoses } from "@/services/ai-incident-agent";
import { encryptOutlookTokenCache, decryptOutlookTokenCache } from "@/services/outlook-crypto";
import { isExpectedExposureStop, isExposureDailyLimitReason } from "@/services/exposure-rules";

export const MCP_EVENT_NAME = "job_agent.alert";
const MCP_VERSION = "2026-07-28";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TTL_MS = 7 * DEFAULT_TTL_MS;
const DELIVERY_RETRY_MS = 30_000;
const MAX_ATTEMPTS = 6;

type JsonObject = Record<string, unknown>;
type SubscriptionParams = {
  name?: unknown;
  arguments?: unknown;
  ttlMs?: unknown;
  delivery?: { mode?: unknown; url?: unknown; secret?: unknown };
};

function enabled() {
  return Boolean(process.env.MCP_EVENTS_AUTH_TOKEN?.trim());
}

function localDiagnosisEnabled() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function isMcpIncidentBridgeEnabled() {
  return enabled() || localDiagnosisEnabled();
}

function token() {
  const value = process.env.MCP_EVENTS_AUTH_TOKEN?.trim();
  if (!value) throw new Error("MCP_EVENTS_AUTH_TOKEN is not configured.");
  return value;
}

export function isMcpEventsEnabled() {
  return enabled();
}

export function isMcpRequestAuthorized(request: Request) {
  if (!enabled()) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${token()}`;
  const actual = Buffer.from(header);
  const target = Buffer.from(expected);
  return actual.length === target.length && timingSafeEqual(actual, target);
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value as JsonObject).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as JsonObject)[key])}`).join(",")}}`;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function secretBytes(secret: string) {
  if (!secret.startsWith("whsec_")) throw new Error("The MCP event secret must start with whsec_.");
  const value = Buffer.from(secret.slice("whsec_".length), "base64");
  if (value.length < 24 || value.length > 64) throw new Error("The MCP event secret must decode to 24-64 bytes.");
  return value;
}

function encryptionKey() {
  return process.env.MCP_EVENTS_ENCRYPTION_KEY ?? process.env.OUTLOOK_TOKEN_ENCRYPTION_KEY;
}

function encryptSecret(secret: string) {
  const key = encryptionKey();
  if (!key) throw new Error("MCP_EVENTS_ENCRYPTION_KEY is not configured.");
  return encryptOutlookTokenCache(secret, key);
}

function decryptSecret(ciphertext: string) {
  const key = encryptionKey();
  if (!key) throw new Error("MCP_EVENTS_ENCRYPTION_KEY is not configured.");
  return decryptOutlookTokenCache(ciphertext, key);
}

function privateAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const lower = address.toLowerCase();
  return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb");
}

export async function validateCallbackUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("MCP event callbacks must use HTTPS.");
  if (url.username || url.password) throw new Error("The MCP event callback URL is invalid.");
  if (["localhost", "localhost.localdomain"].includes(url.hostname.toLowerCase())) throw new Error("MCP event callbacks cannot target localhost.");
  if (isIP(url.hostname) && privateAddress(url.hostname)) throw new Error("MCP event callbacks cannot target a private address.");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => privateAddress(address))) throw new Error("MCP event callbacks cannot target a private address.");
  return url.toString();
}

function signedHeaders(eventId: string, body: string, secret: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secretBytes(secret)).update(`${eventId}.${timestamp}.${body}`).digest("base64");
  return {
    "Content-Type": "application/json",
    "webhook-id": eventId,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": `v1,${signature}`,
  };
}

async function postSigned(url: string, eventId: string, payload: JsonObject, secret: string, subscriptionId: string) {
  await validateCallbackUrl(url);
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body, "utf8") > 256 * 1024) throw new Error("MCP event payload exceeds 256 KiB.");
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: { ...signedHeaders(eventId, body, secret), "X-MCP-Subscription-Id": subscriptionId },
    body,
  });
  return response;
}

async function verifyCallback(url: string, subscriptionId: string, secret: string) {
  const challenge = randomBytes(24).toString("hex");
  const eventId = `msg_verification_${randomBytes(12).toString("hex")}`;
  const response = await postSigned(url, eventId, { type: "verification", challenge }, secret, subscriptionId);
  if (!response.ok) throw new Error(`MCP callback verification returned HTTP ${response.status}.`);
  const result = await response.json().catch(() => null) as { challenge?: unknown } | null;
  if (typeof result?.challenge !== "string" || result.challenge !== challenge) throw new Error("MCP callback verification failed.");
}

function ttlMs(value: unknown) {
  if (value === null || value === undefined) return DEFAULT_TTL_MS;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("ttlMs must be a number or null.");
  return Math.max(5 * 60_000, Math.min(MAX_TTL_MS, Math.floor(value)));
}

function subscriptionIdentity(principalHash: string, name: string, url: string, argumentsHash: string) {
  return `sub_${hash(`${principalHash}\n${name}\n${url}\n${argumentsHash}`).slice(0, 48)}`;
}

export function eventDefinitions() {
  return [{
    name: MCP_EVENT_NAME,
    description: "A contract job agent component needs attention or has recovered.",
    delivery: ["webhook"],
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    payloadSchema: {
      type: "object",
      properties: {
        component: { type: "string" },
        state: { type: "string" },
        reason: { type: "string" },
        needsUser: { type: "boolean" },
        safeToRecover: { type: "boolean" },
        sourceId: { type: ["string", "null"] },
        href: { type: ["string", "null"] },
      },
      required: ["component", "state", "reason", "needsUser", "safeToRecover", "sourceId", "href"],
      additionalProperties: false,
    },
  }];
}

export async function subscribeMcpEvents(principal: string, params: SubscriptionParams) {
  if (params.name !== MCP_EVENT_NAME) throw new Error("Unsupported MCP event.");
  const delivery = params.delivery;
  if (delivery?.mode !== "webhook" || typeof delivery.url !== "string" || typeof delivery.secret !== "string") throw new Error("A webhook delivery URL and secret are required.");
  const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? params.arguments : {};
  const callbackUrl = await validateCallbackUrl(delivery.url);
  secretBytes(delivery.secret);
  const principalHash = hash(principal);
  const argumentsHash = hash(canonicalJson(args));
  const id = subscriptionIdentity(principalHash, MCP_EVENT_NAME, callbackUrl, argumentsHash);
  await verifyCallback(callbackUrl, id, delivery.secret);
  const expiresAt = new Date(Date.now() + ttlMs(params.ttlMs));
  const database = getPrisma();
  await database.mcpEventSubscription.upsert({
    where: { id },
    create: { id, principalHash, eventName: MCP_EVENT_NAME, argumentsHash, arguments: args as Prisma.InputJsonValue, callbackUrl, secretCiphertext: encryptSecret(delivery.secret), expiresAt, verifiedAt: new Date() },
    update: { arguments: args as Prisma.InputJsonValue, callbackUrl, secretCiphertext: encryptSecret(delivery.secret), expiresAt, verifiedAt: new Date() },
  });
  return { id, refreshBefore: new Date(expiresAt.getTime() - Math.max(5 * 60_000, Math.min(60 * 60_000, ttlMs(params.ttlMs) / 4))).toISOString(), cursor: null, truncated: false };
}

export async function unsubscribeMcpEvents(principal: string, params: SubscriptionParams) {
  const delivery = params.delivery;
  if (params.name !== MCP_EVENT_NAME || typeof delivery?.url !== "string") throw new Error("The MCP event subscription is invalid.");
  const callbackUrl = new URL(delivery.url).toString();
  const principalHash = hash(principal);
  const argumentsHash = hash(canonicalJson(params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? params.arguments : {}));
  await getPrisma().mcpEventSubscription.deleteMany({ where: { principalHash, eventName: MCP_EVENT_NAME, callbackUrl, argumentsHash } });
  return {};
}

export async function publishMcpAlert(input: { dedupeKey: string; data: JsonObject; occurredAt?: Date }) {
  if (!isMcpIncidentBridgeEnabled()) return;
  const database = getPrisma();
  const existing = await database.mcpEvent.findUnique({ where: { dedupeKey: input.dedupeKey }, select: { id: true } });
  if (existing) return;
  let event;
  try {
    event = await database.mcpEvent.create({
      data: { eventId: `evt_${randomBytes(16).toString("hex")}`, dedupeKey: input.dedupeKey, name: MCP_EVENT_NAME, data: input.data as Prisma.InputJsonValue, occurredAt: input.occurredAt ?? new Date() },
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002") return;
    throw error;
  }
  const subscriptions = await database.mcpEventSubscription.findMany({ where: { eventName: MCP_EVENT_NAME, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { id: true } });
  for (const subscription of subscriptions) {
    await database.mcpEventDelivery.create({ data: { eventId: event.id, subscriptionId: subscription.id } }).catch(() => {});
  }
}

type DeliveryRow = {
  id: string;
  event: { eventId: string; name: string; data: unknown; occurredAt: Date };
  subscription: { id: string; callbackUrl: string; secretCiphertext: string };
};

async function deliver(row: DeliveryRow) {
  const database = getPrisma();
  const now = new Date();
  const event = row.event;
  const subscription = row.subscription;
  const secret = decryptSecret(subscription.secretCiphertext);
  const payload = { eventId: event.eventId, name: event.name, timestamp: event.occurredAt.toISOString(), data: event.data, cursor: null };
  try {
    const response = await postSigned(subscription.callbackUrl, event.eventId, payload, secret, subscription.id);
    if (!response.ok) throw new Error(`MCP callback returned HTTP ${response.status}.`);
    await database.mcpEventDelivery.update({ where: { id: row.id }, data: { status: McpEventDeliveryStatus.SENT, attempts: { increment: 1 }, lastAttemptAt: now, deliveredAt: now, error: null } });
  } catch (error) {
    await database.mcpEventDelivery.update({ where: { id: row.id }, data: { status: McpEventDeliveryStatus.FAILED, attempts: { increment: 1 }, lastAttemptAt: now, error: (error instanceof Error ? error.message : "MCP event delivery failed.").slice(0, 500) } });
  }
}

export async function retryMcpEventDeliveries() {
  if (!enabled()) return;
  const cutoff = new Date(Date.now() - DELIVERY_RETRY_MS);
  const rows = await getPrisma().mcpEventDelivery.findMany({
    where: { status: { in: [McpEventDeliveryStatus.PENDING, McpEventDeliveryStatus.FAILED] }, attempts: { lt: MAX_ATTEMPTS }, OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: cutoff } }], subscription: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } },
    include: { event: true, subscription: true },
    take: 10,
    orderBy: { lastAttemptAt: "asc" },
  });
  await Promise.all(rows.map((row) => deliver(row)));
}

function activeError(error: string | null, errorClearedAt: Date | null, errorAt: Date | null) {
  return Boolean(error && errorAt && (!errorClearedAt || errorClearedAt < errorAt));
}

function alertData(component: string, reason: string, sourceId: string | null, href: string | null, state = "ERROR") {
  const lower = reason.toLowerCase();
  const needsUser = /login|human check|captcha|authorization|unauthorized|quota exhausted|daily application limit|permission|duplicate send|repeated|unknown|manual/i.test(lower);
  const safeToRecover = /timeout|timed out|429|rate limit|5xx|network|server stopped|temporarily|connection/i.test(lower) && !needsUser;
  return { component, state, reason: reason.slice(0, 500), needsUser, safeToRecover, sourceId, href };
}

export async function scanMcpAlerts() {
  if (!isMcpIncidentBridgeEnabled()) return;
  const database = getPrisma();
  const [exposure, mail, autopilot, failedTasks, failedSweeps] = await Promise.all([
    database.exposureState.findUnique({ where: { id: "primary" }, select: { lastError: true, lastErrorAt: true, errorClearedAt: true, lastStopReason: true, lastStopAt: true } }),
    database.mailScanState.findUnique({ where: { id: "primary" }, select: { lastError: true, lastErrorAt: true, errorClearedAt: true, lastStopReason: true, lastStopAt: true } }),
    database.autopilotControl.findUnique({ where: { id: "primary" }, select: { lastDigestError: true, updatedAt: true } }),
    database.task.findMany({ where: { status: TaskStatus.FAILED, finishedAt: { gte: new Date(Date.now() - 10 * 60_000) }, error: { not: null } }, select: { id: true, error: true, finishedAt: true, href: true }, take: 20 }),
    database.sweep.findMany({ where: { status: "FAILED", updatedAt: { gte: new Date(Date.now() - 30 * 60_000) }, error: { not: null } }, select: { id: true, error: true, updatedAt: true }, take: 10 }),
  ]);
  if (exposure && activeError(exposure.lastError, exposure.errorClearedAt, exposure.lastErrorAt)) await publishMcpAlert({ dedupeKey: `dice.error:${exposure.lastErrorAt!.toISOString()}`, data: alertData("dice", exposure.lastError!, "primary", "/exposure") , occurredAt: exposure.lastErrorAt! });
  if (exposure?.lastStopReason && exposure.lastStopAt && !isExpectedExposureStop(exposure.lastStopReason) && !isExposureDailyLimitReason(exposure.lastStopReason)) await publishMcpAlert({ dedupeKey: `dice.stop:${exposure.lastStopAt.toISOString()}`, data: alertData("dice", exposure.lastStopReason, "primary", "/exposure", "PAUSED"), occurredAt: exposure.lastStopAt });
  if (mail && activeError(mail.lastError, mail.errorClearedAt, mail.lastErrorAt)) await publishMcpAlert({ dedupeKey: `outlook.error:${mail.lastErrorAt!.toISOString()}`, data: alertData("outlook", mail.lastError!, "primary", "/needs-attention"), occurredAt: mail.lastErrorAt! });
  if (mail?.lastStopReason && mail.lastStopAt) await publishMcpAlert({ dedupeKey: `outlook.stop:${mail.lastStopAt.toISOString()}`, data: alertData("outlook", mail.lastStopReason, "primary", "/needs-attention", "PAUSED"), occurredAt: mail.lastStopAt });
  if (autopilot?.lastDigestError) await publishMcpAlert({ dedupeKey: `autopilot.error:${hash(autopilot.lastDigestError)}`, data: alertData("autopilot", autopilot.lastDigestError, "primary", "/autopilot"), occurredAt: autopilot.updatedAt });
  for (const task of failedTasks) if (task.error && task.finishedAt) await publishMcpAlert({ dedupeKey: `task.failed:${task.id}:${task.finishedAt.toISOString()}`, data: alertData("task", task.error, task.id, task.href), occurredAt: task.finishedAt });
  for (const sweep of failedSweeps) if (sweep.error) await publishMcpAlert({ dedupeKey: `linkedin_sweep.failed:${sweep.id}:${sweep.updatedAt.toISOString()}`, data: alertData("linkedin_sweep", sweep.error, sweep.id, "/sweep"), occurredAt: sweep.updatedAt });
  await runPendingAiIncidentDiagnoses();
  await retryMcpEventDeliveries();
}

const globalForMcp = globalThis as unknown as { mcpEventTimer?: ReturnType<typeof setInterval> };

export function startMcpEventBridge() {
  if (!isMcpIncidentBridgeEnabled() || globalForMcp.mcpEventTimer) return;
  const timer = setInterval(() => { void scanMcpAlerts().catch((error) => console.error("MCP event bridge failed:", error instanceof Error ? error.message : error)); }, 30_000);
  timer.unref();
  globalForMcp.mcpEventTimer = timer;
  void scanMcpAlerts().catch((error) => console.error("MCP event bridge failed:", error instanceof Error ? error.message : error));
  console.log(enabled()
    ? "MCP incident bridge started; local diagnoses and HTTPS event delivery are enabled."
    : "MCP incident bridge started; local diagnoses are enabled and HTTPS event delivery is disabled.");
}

export function mcpServerDiscover() {
  return { resultType: "complete", supportedVersions: [MCP_VERSION], capabilities: { tools: {}, events: {} } };
}
