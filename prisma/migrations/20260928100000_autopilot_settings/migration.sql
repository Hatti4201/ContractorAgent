-- The match threshold, the send delay and the daily limit move from the environment to the Autopilot
-- page. Null until first saved, so the environment keeps deciding until the user changes one.
ALTER TABLE "autopilot_control" ADD COLUMN "match_threshold" DOUBLE PRECISION;
ALTER TABLE "autopilot_control" ADD COLUMN "send_delay_minutes" INTEGER;
ALTER TABLE "autopilot_control" ADD COLUMN "daily_send_limit" INTEGER;
