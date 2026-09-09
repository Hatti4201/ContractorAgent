-- The scan's own record of what it judged and why. It keeps a dry run reviewable, explains why a
-- message was passed over, and stops the same mail being classified twice.
CREATE TABLE "intake_scan_decisions" (
    "id" TEXT NOT NULL,
    "outlook_message_id" TEXT NOT NULL,
    "from_address" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "imported" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "intake_scan_decisions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "intake_scan_decisions_outlook_message_id_key" ON "intake_scan_decisions"("outlook_message_id");
CREATE INDEX "intake_scan_decisions_created_at_idx" ON "intake_scan_decisions"("created_at");
