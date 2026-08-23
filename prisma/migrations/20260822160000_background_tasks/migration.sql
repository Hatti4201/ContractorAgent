-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('INTAKE_PIPELINE', 'OUTREACH_REGENERATE', 'OUTREACH_VALIDATE', 'OUTLOOK_DRAFT', 'OUTLOOK_SENT_CHECK', 'FOLLOW_UP_SCAN', 'FOLLOW_UP_RETRY');

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "kind" "TaskKind" NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'RUNNING',
    "label" TEXT NOT NULL,
    "subject_id" TEXT,
    "href" TEXT,
    "progress" TEXT,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_status_started_at_idx" ON "tasks"("status", "started_at");

-- CreateIndex
CREATE INDEX "tasks_subject_id_idx" ON "tasks"("subject_id");
