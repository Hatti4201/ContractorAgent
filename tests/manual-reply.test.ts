import assert from "node:assert/strict";
import test from "node:test";
import { isManualReplyAfterDraft } from "../services/manual-reply";

test("a manual reply after draft creation blocks the automatic send", () => {
  const createdAt = new Date("2026-10-12T20:25:55.000Z");
  assert.equal(isManualReplyAfterDraft({ direction: "outgoing", outlookMessageId: "manual", receivedAt: new Date("2026-10-12T20:27:03.000Z") }, createdAt, "agent-draft"), true);
  assert.equal(isManualReplyAfterDraft({ direction: "outgoing", outlookMessageId: "agent-draft", receivedAt: new Date("2026-10-12T20:27:03.000Z") }, createdAt, "agent-draft"), false);
  assert.equal(isManualReplyAfterDraft({ direction: "outgoing", outlookMessageId: "manual", receivedAt: createdAt }, createdAt, "agent-draft"), false);
});
