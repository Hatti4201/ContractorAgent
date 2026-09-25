-- The autopilot is switched on the dashboard instead of in the environment. The switch replaces the
-- send pause: leaving automatic sending cancels whatever was queued, so there is nothing left to pause.
CREATE TYPE "AutopilotSetting" AS ENUM ('OFF', 'DRAFT', 'SEND');

ALTER TABLE "autopilot_control" ADD COLUMN "mode" "AutopilotSetting";
-- A paused sender keeps its drafts in Outlook: it becomes DRAFT, never a surprise SEND.
UPDATE "autopilot_control" SET "mode" = 'DRAFT' WHERE "send_paused" = true;
ALTER TABLE "autopilot_control" DROP COLUMN "send_paused";

ALTER TYPE "TaskKind" ADD VALUE 'AUTOPILOT_BATCH';
