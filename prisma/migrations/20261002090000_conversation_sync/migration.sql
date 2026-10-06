ALTER TABLE "mail_scan_state"
  ADD COLUMN "auto_scan_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "initial_scan_complete_at" TIMESTAMP(3),
  ADD COLUMN "folder_watermarks" JSONB;

CREATE TABLE "conversation_threads" (
  "id" TEXT NOT NULL,
  "outlook_conversation_id" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "recruiter_name" TEXT,
  "recruiter_email" TEXT,
  "is_relevant" BOOLEAN NOT NULL DEFAULT false,
  "is_hidden" BOOLEAN NOT NULL DEFAULT true,
  "summary" TEXT,
  "last_message_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "conversation_threads_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "conversation_threads_outlook_conversation_id_key" ON "conversation_threads"("outlook_conversation_id");
CREATE INDEX "conversation_threads_relevant_hidden_last_idx" ON "conversation_threads"("is_relevant", "is_hidden", "last_message_at");

CREATE TABLE "conversation_messages" (
  "id" TEXT NOT NULL,
  "outlook_message_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "folder" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "from_address" TEXT NOT NULL,
  "to_addresses" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "body_preview" TEXT NOT NULL,
  "sent_at" TIMESTAMP(3),
  "received_at" TIMESTAMP(3) NOT NULL,
  "is_relevant" BOOLEAN NOT NULL DEFAULT false,
  "is_hidden" BOOLEAN NOT NULL DEFAULT true,
  "message_type" TEXT,
  "summary" TEXT,
  "reply_draft" TEXT,
  "analyzed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "conversation_messages_outlook_message_id_key" ON "conversation_messages"("outlook_message_id");
CREATE INDEX "conversation_messages_conversation_received_idx" ON "conversation_messages"("conversation_id", "received_at");
CREATE INDEX "conversation_messages_relevant_hidden_received_idx" ON "conversation_messages"("is_relevant", "is_hidden", "received_at");
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "conversation_jobs" (
  "conversation_id" TEXT NOT NULL,
  "opportunity_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversation_jobs_pkey" PRIMARY KEY ("conversation_id", "opportunity_id")
);
CREATE INDEX "conversation_jobs_opportunity_id_idx" ON "conversation_jobs"("opportunity_id");
ALTER TABLE "conversation_jobs" ADD CONSTRAINT "conversation_jobs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_jobs" ADD CONSTRAINT "conversation_jobs_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
