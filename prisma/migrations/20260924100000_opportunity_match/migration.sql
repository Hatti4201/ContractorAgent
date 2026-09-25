-- How well the approved candidate context covers the job's stated requirements, kept with the job so
-- the autopilot's decision can be read back afterwards. The score is null when the JD listed no skills.
ALTER TABLE "opportunities" ADD COLUMN "match_score" DOUBLE PRECISION,
ADD COLUMN "match_report" JSONB;
