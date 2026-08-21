-- CreateEnum
CREATE TYPE "JobSourceType" AS ENUM ('LINKEDIN_POST', 'LINKEDIN_DM', 'DIRECT_EMAIL', 'FORWARDED_JD', 'PLAIN_TEXT');

-- CreateEnum
CREATE TYPE "IntakeStatus" AS ENUM ('PENDING', 'CONFIRMED');

-- AlterTable
ALTER TABLE "opportunities" ADD COLUMN "job_case" JSONB,
ADD COLUMN "jd_fingerprint" TEXT;

-- CreateTable
CREATE TABLE "job_intakes" (
    "id" TEXT NOT NULL,
    "source_type" "JobSourceType" NOT NULL,
    "raw_text" TEXT NOT NULL,
    "original_sender" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL,
    "attachment_metadata" JSONB,
    "analysis" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" "IntakeStatus" NOT NULL DEFAULT 'PENDING',
    "opportunity_id" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_intakes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "opportunities_jd_fingerprint_idx" ON "opportunities"("jd_fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "job_intakes_opportunity_id_key" ON "job_intakes"("opportunity_id");

-- CreateIndex
CREATE INDEX "job_intakes_status_created_at_idx" ON "job_intakes"("status", "created_at");

-- CreateIndex
CREATE INDEX "job_intakes_fingerprint_idx" ON "job_intakes"("fingerprint");

-- AddForeignKey
ALTER TABLE "job_intakes" ADD CONSTRAINT "job_intakes_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
