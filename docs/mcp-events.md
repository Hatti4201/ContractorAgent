# Contract Job Agent → MCP Events → LLM

The app now exposes an MCP Events endpoint at `/mcp`.

Flow:

```text
Docker services → MCP event bridge → HTTPS /mcp subscription → signed webhook → ChatGPT/LLM
```

The bridge watches only actionable state: Dice blockers/errors, Outlook errors/stops, Autopilot digest failures, failed tasks, and failed LinkedIn sweeps. It stores event IDs, diagnoses, and delivery attempts in Postgres so a restart does not duplicate an event; transient delivery failures retry up to six times. The local OpenAI diagnosis path is independent of public HTTPS delivery: `OPENAI_API_KEY` enables scanning and diagnosis, while `MCP_EVENTS_AUTH_TOKEN` additionally enables public MCP subscriptions and webhooks.

## Enable it

1. Set `OPENAI_API_KEY` in `.env` to enable local scanning and API diagnosis.
2. To add external event wakeups, set a long random `MCP_EVENTS_AUTH_TOKEN` and `MCP_EVENTS_ENCRYPTION_KEY` in `.env`.
3. Expose the container's `/mcp` route through a public HTTPS MCP/plugin endpoint. A localhost URL is deliberately rejected for callback delivery.
4. Connect that endpoint to ChatGPT Work/Cloud and ask it to monitor `job_agent.alert` and diagnose or recover incidents according to the existing operator instructions.

The hourly Codex heartbeat remains the fallback when the MCP subscription or public tunnel is unavailable. The bridge does not send mail, click Dice, bypass human verification, or change Autopilot mode.
