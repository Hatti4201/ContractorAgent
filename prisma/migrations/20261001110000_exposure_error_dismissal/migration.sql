ALTER TABLE "exposure_state"
ADD COLUMN "last_error_at" TIMESTAMP(3),
ADD COLUMN "error_cleared_at" TIMESTAMP(3);
