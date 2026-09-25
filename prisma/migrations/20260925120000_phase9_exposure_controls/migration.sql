-- Phase 9 controls: additive only. Nullable or defaulted columns on the single exposure_state row.
ALTER TABLE "exposure_state" ADD COLUMN "settings" JSONB;
ALTER TABLE "exposure_state" ADD COLUMN "stop_requested" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "exposure_state" ADD COLUMN "progress" TEXT;
