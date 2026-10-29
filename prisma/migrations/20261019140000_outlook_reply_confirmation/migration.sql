ALTER TABLE "conversation_messages"
ADD COLUMN IF NOT EXISTS "reply_sent_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "reply_sending_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "reply_send_error" TEXT;
