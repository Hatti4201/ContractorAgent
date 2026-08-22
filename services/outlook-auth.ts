import "server-only";

import {
  ConfidentialClientApplication,
  LogLevel,
  type ICachePlugin,
} from "@azure/msal-node";
import { getPrisma } from "@/lib/prisma";
import { decryptOutlookTokenCache, encryptOutlookTokenCache } from "@/services/outlook-crypto";

const CONNECTION_ID = "primary";
export const OUTLOOK_SCOPES = ["Mail.ReadWrite"];

function environment() {
  const clientId = process.env.MICROSOFT_CLIENT_ID ?? "";
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET ?? "";
  const tenantId = process.env.MICROSOFT_TENANT_ID ?? "common";
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) throw new Error("MICROSOFT_CLIENT_ID is not configured.");
  if (clientSecret.length < 16) throw new Error("MICROSOFT_CLIENT_SECRET is not configured.");
  if (!/^(common|organizations|consumers|[0-9a-f-]{36})$/i.test(tenantId)) throw new Error("MICROSOFT_TENANT_ID is invalid.");
  let callback: URL;
  try { callback = new URL(redirectUri); } catch { throw new Error("MICROSOFT_REDIRECT_URI is invalid."); }
  if (callback.protocol !== "https:" && !(callback.protocol === "http:" && ["localhost", "127.0.0.1"].includes(callback.hostname))) {
    throw new Error("MICROSOFT_REDIRECT_URI must use HTTPS, except on localhost.");
  }
  if (callback.pathname !== "/api/outlook/callback" || callback.search || callback.hash) throw new Error("MICROSOFT_REDIRECT_URI must end with /api/outlook/callback.");
  return { clientId, clientSecret, tenantId, redirectUri: callback.toString() };
}

function cachePlugin(loadExisting: boolean): ICachePlugin {
  // ponytail: one encrypted cache row matches this single-user app; partition by user only if multi-user scope is approved.
  return {
    beforeCacheAccess: async (context) => {
      if (!loadExisting) return;
      const stored = await getPrisma().outlookConnection.findUnique({ where: { id: CONNECTION_ID } });
      if (stored) context.tokenCache.deserialize(decryptOutlookTokenCache(stored.encryptedTokenCache));
    },
    afterCacheAccess: async (context) => {
      if (!context.cacheHasChanged) return;
      await getPrisma().outlookConnection.upsert({
        where: { id: CONNECTION_ID },
        create: { id: CONNECTION_ID, encryptedTokenCache: encryptOutlookTokenCache(context.tokenCache.serialize()) },
        update: { encryptedTokenCache: encryptOutlookTokenCache(context.tokenCache.serialize()) },
      });
    },
  };
}

function client(loadExisting: boolean) {
  const config = environment();
  return {
    config,
    application: new ConfidentialClientApplication({
      auth: {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        authority: `https://login.microsoftonline.com/${config.tenantId}`,
      },
      cache: { cachePlugin: cachePlugin(loadExisting) },
      system: { loggerOptions: { loggerCallback: () => {}, piiLoggingEnabled: false, logLevel: LogLevel.Error } },
    }),
  };
}

export function outlookEnvironmentConfigured() {
  try { environment(); encryptOutlookTokenCache("configuration-check"); return true; } catch { return false; }
}

export async function outlookConnected() {
  return Boolean(await getPrisma().outlookConnection.findUnique({ where: { id: CONNECTION_ID }, select: { id: true } }));
}

export async function outlookAuthorizationUrl(state: string, codeChallenge: string) {
  const { application, config } = client(false);
  return application.getAuthCodeUrl({
    scopes: OUTLOOK_SCOPES,
    redirectUri: config.redirectUri,
    state,
    codeChallenge,
    codeChallengeMethod: "S256",
    prompt: "select_account",
  });
}

export async function completeOutlookAuthorization(code: string, codeVerifier: string) {
  const { application, config } = client(false);
  const result = await application.acquireTokenByCode({ code, codeVerifier, scopes: OUTLOOK_SCOPES, redirectUri: config.redirectUri });
  if (!result?.accessToken) throw new Error("Microsoft authorization did not return an access token.");
}

export async function outlookAccessToken() {
  const { application } = client(true);
  const accounts = await application.getTokenCache().getAllAccounts();
  if (accounts.length !== 1) throw new Error("Reconnect Outlook before creating a draft.");
  const result = await application.acquireTokenSilent({ account: accounts[0]!, scopes: OUTLOOK_SCOPES });
  if (!result?.accessToken) throw new Error("Reconnect Outlook before creating a draft.");
  return result.accessToken;
}

export async function disconnectOutlookConnection() {
  await getPrisma().outlookConnection.deleteMany({ where: { id: CONNECTION_ID } });
}
