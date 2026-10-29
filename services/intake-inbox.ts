import { listOutlookInboxMessages, type OutlookInboxMessage } from "@/services/outlook-graph";
import { outlookAccessToken, outlookConnected } from "@/services/outlook-auth";

type InboxSnapshot = { messages: OutlookInboxMessage[] };

// shortcut: process-local cache, sufficient for this single-container app; use shared storage if it is scaled.
const globalForIntakeInbox = globalThis as unknown as {
  snapshot?: InboxSnapshot;
  sync?: Promise<InboxSnapshot | null>;
};

export function cachedInbox() {
  return globalForIntakeInbox.snapshot ?? null;
}

export async function syncInbox() {
  if (globalForIntakeInbox.sync) return globalForIntakeInbox.sync;

  const run = (async () => {
    if (!await outlookConnected()) {
      globalForIntakeInbox.snapshot = undefined;
      return null;
    }
    const messages = (await listOutlookInboxMessages({ accessToken: await outlookAccessToken() })).slice().reverse();
    const snapshot = { messages };
    globalForIntakeInbox.snapshot = snapshot;
    return snapshot;
  })();
  globalForIntakeInbox.sync = run;
  try {
    return await run;
  } finally {
    if (globalForIntakeInbox.sync === run) globalForIntakeInbox.sync = undefined;
  }
}
