-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'OUTREACH_DRAFT_GENERATED';
ALTER TYPE "ActivityType" ADD VALUE 'OUTREACH_DRAFT_EDITED';
ALTER TYPE "ActivityType" ADD VALUE 'OUTREACH_DRAFT_APPROVED';

-- CreateEnum
CREATE TYPE "OutreachMode" AS ENUM ('FIRST_OUTREACH', 'THREAD_FOLLOW_UP', 'DIRECT_EMAIL_REPLY', 'FORWARDED_JD_OUTREACH');

-- CreateEnum
CREATE TYPE "OutreachDraftStatus" AS ENUM ('DRAFT', 'NEEDS_REVIEW', 'APPROVED');

-- CreateTable
CREATE TABLE "outreach_drafts" (
    "id" TEXT NOT NULL,
    "opportunity_id" TEXT NOT NULL,
    "mode" "OutreachMode" NOT NULL,
    "to_address" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachment_resume_id" TEXT NOT NULL,
    "context_fingerprint" TEXT NOT NULL,
    "validation" JSONB NOT NULL,
    "status" "OutreachDraftStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outreach_drafts_opportunity_id_key" ON "outreach_drafts"("opportunity_id");
CREATE INDEX "outreach_drafts_status_idx" ON "outreach_drafts"("status");
CREATE INDEX "outreach_drafts_attachment_resume_id_idx" ON "outreach_drafts"("attachment_resume_id");

-- AddForeignKey
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_attachment_resume_id_fkey" FOREIGN KEY ("attachment_resume_id") REFERENCES "resumes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
