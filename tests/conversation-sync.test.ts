import assert from "node:assert/strict";
import test from "node:test";
import { isInteractiveOutlookMessage, isManualOutlookReply } from "../services/conversation-sync";

test("only an outgoing message without an Agent draft counts as a manual reply", () => {
  const messages = [
    { outlookMessageId: "agent", direction: "outgoing" },
    { outlookMessageId: "manual", direction: "outgoing" },
    { outlookMessageId: "recruiter", direction: "incoming" },
  ];
  assert.equal(isManualOutlookReply(messages, new Set(["agent"])), true);
  assert.equal(isManualOutlookReply(messages.filter((message) => message.outlookMessageId !== "manual"), new Set(["agent"])), false);
});

test("automated do-not-reply messages stay out of interactive conversations", () => {
  assert.equal(isInteractiveOutlookMessage({ fromAddress: "alerts@example.com", subject: "Job update", preview: "Please note that this is an automated message, please do not reply to this email." }, "focused"), false);
  assert.equal(isInteractiveOutlookMessage({ fromAddress: "recruiter@example.com", subject: "Java role", preview: "Please let me know if you are interested." }, "focused"), true);
});
