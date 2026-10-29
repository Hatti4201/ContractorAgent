import assert from "node:assert/strict";
import test from "node:test";
import { buildIncidentInput, parseIncidentResult } from "@/services/ai-incident-agent";

test("incident input keeps telemetry structured and redacts secrets", () => {
  const input = buildIncidentInput({
    eventId: "evt_1",
    name: "job_agent.alert",
    occurredAt: new Date("2026-10-20T12:00:00.000Z"),
    data: { component: "outlook", state: "ERROR", reason: "alice@example.com token=secret-value", href: "/needs-attention", needsUser: true },
  });
  assert.equal(input.incident.reason, "[email redacted] token=[redacted]");
  assert.equal(input.incident.href, "/needs-attention");
});

test("incident diagnosis parser rejects incomplete model output", () => {
  assert.throws(() => parseIncidentResult(JSON.stringify({ severity: "ERROR" })), /incomplete incident diagnosis/);
});
