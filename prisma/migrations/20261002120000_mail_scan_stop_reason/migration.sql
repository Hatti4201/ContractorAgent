ALTER TABLE "mail_scan_state"
ADD COLUMN IF NOT EXISTS "last_stop_reason" TEXT,
ADD COLUMN IF NOT EXISTS "last_stop_at" TIMESTAMP(3);
