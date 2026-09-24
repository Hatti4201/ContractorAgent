-- Phase 9: additive only. New enums and tables; nothing existing is altered.
CREATE TYPE "ExposureChannel" AS ENUM ('DICE');

CREATE TYPE "ExposureResult" AS ENUM ('APPLIED', 'DRY_RUN_READY', 'SKIPPED', 'FAILED');

CREATE TABLE "exposure_applications" (
    "id" TEXT NOT NULL,
    "channel" "ExposureChannel" NOT NULL,
    "external_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT,
    "url" TEXT NOT NULL,
    "result" "ExposureResult" NOT NULL,
    "reason" TEXT,
    "answers" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exposure_applications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "exposure_applications_channel_external_id_idx" ON "exposure_applications"("channel", "external_id");

CREATE INDEX "exposure_applications_created_at_idx" ON "exposure_applications"("created_at");

CREATE TABLE "exposure_state" (
    "id" TEXT NOT NULL DEFAULT 'primary',
    "last_run_at" TIMESTAMP(3),
    "last_success_at" TIMESTAMP(3),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exposure_state_pkey" PRIMARY KEY ("id")
);
