-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'OUTLOOK_DRAFT_CREATED';

-- CreateEnum
CREATE TYPE "OutlookDraftState" AS ENUM ('NOT_CREATED', 'CREATING', 'CREATED', 'FAILED', 'NEEDS_REVIEW', 'SENT');

-- AlterTable
ALTER TABLE "outreach_drafts"
ADD COLUMN "outlook_state" "OutlookDraftState" NOT NULL DEFAULT 'NOT_CREATED',
ADD COLUMN "outlook_message_id" TEXT,
ADD COLUMN "outlook_web_link" TEXT,
ADD COLUMN "outlook_error" TEXT,
ADD COLUMN "outlook_draft_revision" INTEGER,
ADD COLUMN "outlook_draft_created_at" TIMESTAMP(3),
ADD COLUMN "reply_source_message_id" TEXT,
ADD COLUMN "sent_confirmed_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "outlook_connections" (
    "id" TEXT NOT NULL DEFAULT 'primary',
    "encrypted_token_cache" TEXT NOT NULL,
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outlook_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outreach_drafts_outlook_message_id_key" ON "outreach_drafts"("outlook_message_id");
CREATE INDEX "outreach_drafts_outlook_state_idx" ON "outreach_drafts"("outlook_state");
