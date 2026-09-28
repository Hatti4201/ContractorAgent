-- Jobs the user deleted, so the same JD from the same recruiter does not come back in.
CREATE TABLE "deleted_jobs" (
    "id" TEXT NOT NULL,
    "jd_fingerprint" TEXT NOT NULL,
    "recruiter_email" TEXT,
    "title" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deleted_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "deleted_jobs_jd_fingerprint_idx" ON "deleted_jobs"("jd_fingerprint");
