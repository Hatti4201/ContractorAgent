-- The Outlook message an intake was taken from: it binds the reply to the original mail, and its
-- uniqueness is what stops the same message being imported twice. Null for every pasted source.
ALTER TABLE "job_intakes" ADD COLUMN "source_message_id" TEXT;
CREATE UNIQUE INDEX "job_intakes_source_message_id_key" ON "job_intakes"("source_message_id");
