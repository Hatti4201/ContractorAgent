-- LinkedIn Sweep: pasted feed pages, their posts, and the application-rule decision on every intake.
ALTER TYPE "IntakeStatus" ADD VALUE 'SKIPPED';

CREATE TYPE "SweepStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED');
CREATE TYPE "SweepOutcome" AS ENUM ('NOISE', 'NOT_RELEVANT', 'SKIPPED', 'NO_EMAIL', 'QUEUED', 'FAILED');

ALTER TABLE "job_intakes" ADD COLUMN "policy" JSONB;

-- A sweep prepares dozens of jobs at once; their tasks are tracked on the sweep page, not the tray.
ALTER TABLE "tasks" ADD COLUMN "silent" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "sweeps" (
    "id" TEXT NOT NULL,
    "status" "SweepStatus" NOT NULL DEFAULT 'RUNNING',
    "progress" TEXT,
    "error" TEXT,
    "post_count" INTEGER NOT NULL,
    "repeats" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sweeps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sweep_posts" (
    "id" TEXT NOT NULL,
    "sweep_id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "profile_url" TEXT,
    "headline" TEXT,
    "text" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "outcome" "SweepOutcome" NOT NULL,
    "reason" TEXT,
    "intake_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sweep_posts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sweeps_created_at_idx" ON "sweeps"("created_at");
CREATE UNIQUE INDEX "sweep_posts_fingerprint_key" ON "sweep_posts"("fingerprint");
CREATE UNIQUE INDEX "sweep_posts_intake_id_key" ON "sweep_posts"("intake_id");
CREATE INDEX "sweep_posts_sweep_id_idx" ON "sweep_posts"("sweep_id");

ALTER TABLE "sweep_posts" ADD CONSTRAINT "sweep_posts_sweep_id_fkey" FOREIGN KEY ("sweep_id") REFERENCES "sweeps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sweep_posts" ADD CONSTRAINT "sweep_posts_intake_id_fkey" FOREIGN KEY ("intake_id") REFERENCES "job_intakes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
