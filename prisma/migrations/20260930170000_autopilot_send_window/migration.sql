-- Automatic sending uses its own local-time window; Outlook scanning may be disabled independently.
ALTER TABLE "autopilot_control" ADD COLUMN "send_start_time" TEXT,
ADD COLUMN "send_end_time" TEXT;

-- The old delay setting was removed when SEND became immediate inside the configured window.
ALTER TABLE "autopilot_control" DROP COLUMN "send_delay_minutes";
