# OpenAI API Agent ↔ Codex

The local service now uses an event-driven bridge:

1. The existing MCP event scanner checks local state every 30 seconds and writes a durable `McpEvent` only when it finds a new actionable incident. This local diagnosis path runs when `OPENAI_API_KEY` is configured; it does not require a public MCP token.
2. The API Agent calls the OpenAI Responses API only for a new incident (or a retry after 15 minutes). It receives redacted, structured telemetry; it does not receive email bodies, resumes, tokens, or passwords.
3. The result is stored in `AiIncidentDiagnosis`. The Dashboard shows recent action-required results, and `GET /api/agent/incidents` returns the same structured state for the local Codex heartbeat.
4. The API Agent does not send mail, click Dice, bypass CAPTCHA, edit code, or inject text into a ChatGPT conversation. Safe deterministic schedulers remain responsible for retries; uncertain external actions stay visible for the user.

The read endpoint requires `Authorization: Bearer $MCP_EVENTS_AUTH_TOKEN`. It is read-only and should only be exposed through the existing authenticated HTTPS MCP route/tunnel. Public webhook delivery is optional for the local diagnosis path. `OPENAI_AGENT_MODEL` is optional; when blank, the existing `OPENAI_MODEL` is reused.

This is shared state, not direct message injection: the local API worker cannot post into the current ChatGPT/Codex thread. Codex reads the same incident state during its heartbeat or when the user asks for a status update.
