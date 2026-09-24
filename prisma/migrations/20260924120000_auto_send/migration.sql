-- Automatic sending of drafts the autopilot built: a shadow record first, then a delayed send the
-- user can cancel, counted against a rolling daily limit and stopped by a switch on the dashboard.
CREATE TYPE "AutoSendState" AS ENUM ('SHADOW', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED', 'FAILED');

ALTER TYPE "TaskKind" ADD VALUE 'AUTO_SEND';

ALTER TABLE "outreach_drafts" ADD COLUMN "auto_send_state" "AutoSendState",
ADD COLUMN "auto_send_at" TIMESTAMP(3),
ADD COLUMN "auto_sent_at" TIMESTAMP(3),
ADD COLUMN "auto_send_error" TEXT;

CREATE INDEX "outreach_drafts_auto_send_state_auto_send_at_idx" ON "outreach_drafts"("auto_send_state", "auto_send_at");
CREATE INDEX "outreach_drafts_auto_sent_at_idx" ON "outreach_drafts"("auto_sent_at");

CREATE TABLE "autopilot_control" (
    "id" TEXT NOT NULL DEFAULT 'primary',
    "send_paused" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "autopilot_control_pkey" PRIMARY KEY ("id")
);
