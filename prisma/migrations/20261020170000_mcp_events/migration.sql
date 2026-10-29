-- MCP event subscriptions and durable webhook delivery state.
CREATE TYPE "McpEventDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "mcp_event_subscriptions" (
    "id" TEXT NOT NULL,
    "principal_hash" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "arguments_hash" TEXT NOT NULL,
    "arguments" JSONB,
    "callback_url" TEXT NOT NULL,
    "secret_ciphertext" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_event_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mcp_events" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mcp_event_deliveries" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "status" "McpEventDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "mcp_event_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mcp_event_subscriptions_identity_key" ON "mcp_event_subscriptions"("principal_hash", "event_name", "callback_url", "arguments_hash");
CREATE INDEX "mcp_event_subscriptions_event_name_expires_at_idx" ON "mcp_event_subscriptions"("event_name", "expires_at");
CREATE UNIQUE INDEX "mcp_events_event_id_key" ON "mcp_events"("event_id");
CREATE UNIQUE INDEX "mcp_events_dedupe_key_key" ON "mcp_events"("dedupe_key");
CREATE INDEX "mcp_events_name_occurred_at_idx" ON "mcp_events"("name", "occurred_at");
CREATE UNIQUE INDEX "mcp_event_deliveries_event_id_subscription_id_key" ON "mcp_event_deliveries"("event_id", "subscription_id");
CREATE INDEX "mcp_event_deliveries_status_last_attempt_at_idx" ON "mcp_event_deliveries"("status", "last_attempt_at");

ALTER TABLE "mcp_event_deliveries" ADD CONSTRAINT "mcp_event_deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "mcp_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_event_deliveries" ADD CONSTRAINT "mcp_event_deliveries_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "mcp_event_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
