-- CreateTable
CREATE TABLE "mail_scan_state" (
    "id" TEXT NOT NULL DEFAULT 'primary',
    "watermark" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "last_success_at" TIMESTAMP(3),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_scan_state_pkey" PRIMARY KEY ("id")
);
