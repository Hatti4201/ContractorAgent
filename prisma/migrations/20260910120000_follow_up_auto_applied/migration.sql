-- RESTRICTIONS 1.2 lets the scan maintain the follow-up fields on its own. This records when it did,
-- so the screen can say so and a later confirmation does not rewrite what is already applied.
ALTER TABLE "follow_up_suggestions" ADD COLUMN "follow_up_applied_at" TIMESTAMP(3);
