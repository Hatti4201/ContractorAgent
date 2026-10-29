import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, eventDefinitions, isMcpIncidentBridgeEnabled } from "../services/mcp-events";

test("canonicalJson makes subscription arguments order-independent", () => {
  assert.equal(canonicalJson({ b: 2, a: { d: true, c: [3, 1] } }), '{"a":{"c":[3,1],"d":true},"b":2}');
});

test("MCP event definition is webhook-only and does not expose job text", () => {
  const definition = eventDefinitions()[0];
  assert.deepEqual(definition.delivery, ["webhook"]);
  assert.equal(definition.payloadSchema.additionalProperties, false);
  assert.equal("rawText" in definition.payloadSchema.properties, false);
});

test("local diagnosis remains enabled without a public MCP token", () => {
  const token = process.env.MCP_EVENTS_AUTH_TOKEN;
  const key = process.env.OPENAI_API_KEY;
  delete process.env.MCP_EVENTS_AUTH_TOKEN;
  process.env.OPENAI_API_KEY = "test-key";
  try {
    assert.equal(isMcpIncidentBridgeEnabled(), true);
  } finally {
    if (token === undefined) delete process.env.MCP_EVENTS_AUTH_TOKEN;
    else process.env.MCP_EVENTS_AUTH_TOKEN = token;
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
  }
});
