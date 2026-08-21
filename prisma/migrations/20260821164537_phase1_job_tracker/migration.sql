-- CreateEnum
CREATE TYPE "ApplicationStage" AS ENUM ('DISCOVERED', 'OUTREACH_SENT', 'RECRUITER_ENGAGED', 'RTR_SIGNED', 'SUBMITTED_TO_CLIENT', 'INTERVIEW_SCHEDULED', 'INTERVIEW_COMPLETED', 'OFFER', 'HIRED', 'NO_RESPONSE', 'REJECTED', 'ROLE_CLOSED', 'WITHDRAWN', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('JOB_CREATED', 'JOB_UPDATED', 'JD_RECEIVED', 'OUTREACH_SENT', 'RECRUITER_REPLY', 'CALL', 'RTR_RECEIVED', 'RTR_SIGNED', 'CLIENT_SUBMISSION', 'INTERVIEW_SCHEDULED', 'INTERVIEW_COMPLETED', 'OFFER', 'STAGE_CHANGED', 'NOTE', 'CORRECTION');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('UNKNOWN', 'CONTRACT', 'W2', 'C2C', 'CONTRACT_1099', 'FULL_TIME');

-- CreateEnum
CREATE TYPE "WorkArrangement" AS ENUM ('UNKNOWN', 'REMOTE', 'HYBRID', 'ONSITE');

-- CreateEnum
CREATE TYPE "RoleFamily" AS ENUM ('JAVA_BACKEND', 'JAVA_FULLSTACK', 'JAVA_REACT', 'JAVA_AI', 'REACT', 'REACT_FULLSTACK');

-- CreateTable
CREATE TABLE "opportunities" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "client" TEXT,
    "location" TEXT,
    "employment_type" "EmploymentType" NOT NULL DEFAULT 'UNKNOWN',
    "work_arrangement" "WorkArrangement" NOT NULL DEFAULT 'UNKNOWN',
    "raw_jd" TEXT,
    "recruiter_id" TEXT,
    "vendor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_tracks" (
    "id" TEXT NOT NULL,
    "opportunity_id" TEXT NOT NULL,
    "current_stage" "ApplicationStage" NOT NULL DEFAULT 'DISCOVERED',
    "waiting_on" TEXT,
    "next_action" TEXT,
    "next_follow_up_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL,
    "opportunity_id" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "description" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruiters" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "vendor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recruiters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resumes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role_family" "RoleFamily" NOT NULL,
    "file_path" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resumes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "opportunities_recruiter_id_idx" ON "opportunities"("recruiter_id");

-- CreateIndex
CREATE INDEX "opportunities_vendor_id_idx" ON "opportunities"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "application_tracks_opportunity_id_key" ON "application_tracks"("opportunity_id");

-- CreateIndex
CREATE INDEX "application_tracks_current_stage_idx" ON "application_tracks"("current_stage");

-- CreateIndex
CREATE INDEX "application_tracks_next_follow_up_at_idx" ON "application_tracks"("next_follow_up_at");

-- CreateIndex
CREATE INDEX "activities_opportunity_id_occurred_at_idx" ON "activities"("opportunity_id", "occurred_at");

-- CreateIndex
CREATE INDEX "recruiters_email_idx" ON "recruiters"("email");

-- CreateIndex
CREATE INDEX "recruiters_vendor_id_idx" ON "recruiters"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_name_key" ON "vendors"("name");

-- CreateIndex
CREATE UNIQUE INDEX "resumes_name_version_key" ON "resumes"("name", "version");

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_recruiter_id_fkey" FOREIGN KEY ("recruiter_id") REFERENCES "recruiters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_tracks" ADD CONSTRAINT "application_tracks_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruiters" ADD CONSTRAINT "recruiters_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
