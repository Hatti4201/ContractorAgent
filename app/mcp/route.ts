import {
  eventDefinitions,
  isMcpRequestAuthorized,
  mcpServerDiscover,
  subscribeMcpEvents,
  unsubscribeMcpEvents,
} from "@/services/mcp-events";

type JsonRpcRequest = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

function response(id: unknown, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result }, { headers: { "Cache-Control": "no-store" } });
}

function error(id: unknown, code: number, message: string, data?: unknown) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } }, { status: 400, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isMcpRequestAuthorized(request)) return Response.json({ error: "Unauthorized." }, { status: 401 });
  let body: JsonRpcRequest;
  try {
    body = await request.json() as JsonRpcRequest;
  } catch {
    return error(null, -32700, "Invalid JSON.");
  }
  const id = body.id ?? null;
  const method = typeof body.method === "string" ? body.method : "";
  const params = body.params && typeof body.params === "object" && !Array.isArray(body.params) ? body.params as Record<string, unknown> : {};
  try {
    if (method === "server/discover") return response(id, mcpServerDiscover());
    if (method === "events/list") return response(id, { events: eventDefinitions(), nextCursor: null });
    if (method === "events/subscribe") return response(id, await subscribeMcpEvents(request.headers.get("authorization") ?? "", params as Parameters<typeof subscribeMcpEvents>[1]));
    if (method === "events/unsubscribe") return response(id, await unsubscribeMcpEvents(request.headers.get("authorization") ?? "", params as Parameters<typeof unsubscribeMcpEvents>[1]));
    return error(id, -32601, "Method not found.");
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "MCP request failed.";
    return error(id, method === "events/subscribe" ? -32015 : -32602, message, method === "events/subscribe" ? { reason: "callback_failed" } : undefined);
  }
}

export async function GET() {
  return Response.json({ ok: true, service: "contract-job-agent-mcp-events" }, { headers: { "Cache-Control": "no-store" } });
}
