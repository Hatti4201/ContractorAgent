-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('PENDING', 'FAILED', 'CONFIRMED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "FollowUpEvent" AS ENUM ('RECRUITER_REPLY', 'RTR_RECEIVED', 'CLIENT_SUBMISSION', 'INTERVIEW_SCHEDULED', 'INTERVIEW_COMPLETED', 'OFFER', 'REJECTION', 'ROLE_CLOSED', 'NO_ACTION');

-- CreateTable
CREATE TABLE "follow_up_suggestions" (
    "id" TEXT NOT NULL,
    "outlook_message_id" TEXT NOT NULL,
    "opportunity_id" TEXT,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'PENDING',
    "from_address" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "event" "FollowUpEvent",
    "proposed_activity" "ActivityType",
    "proposed_stage" "ApplicationStage",
    "proposed_waiting_on" TEXT,
    "proposed_next_action" TEXT,
    "proposed_next_follow_up_at" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION,
    "evidence" JSONB,
    "error" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "analyzed_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "follow_up_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "follow_up_suggestions_outlook_message_id_key" ON "follow_up_suggestions"("outlook_message_id");
CREATE INDEX "follow_up_suggestions_status_received_at_idx" ON "follow_up_suggestions"("status", "received_at");
CREATE INDEX "follow_up_suggestions_opportunity_id_idx" ON "follow_up_suggestions"("opportunity_id");

-- AddForeignKey
ALTER TABLE "follow_up_suggestions" ADD CONSTRAINT "follow_up_suggestions_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
