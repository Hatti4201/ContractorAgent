CREATE TYPE "AiIncidentDiagnosisStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "ai_incident_diagnoses" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "status" "AiIncidentDiagnosisStatus" NOT NULL DEFAULT 'PENDING',
    "severity" TEXT,
    "summary" TEXT,
    "diagnosis" TEXT,
    "recommended_action" TEXT,
    "needs_user" BOOLEAN,
    "safe_to_recover" BOOLEAN,
    "codex_handoff" TEXT,
    "model" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_incident_diagnoses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_incident_diagnoses_event_id_key" ON "ai_incident_diagnoses"("event_id");
CREATE INDEX "ai_incident_diagnoses_status_created_at_idx" ON "ai_incident_diagnoses"("status", "created_at");

ALTER TABLE "ai_incident_diagnoses" ADD CONSTRAINT "ai_incident_diagnoses_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "mcp_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
