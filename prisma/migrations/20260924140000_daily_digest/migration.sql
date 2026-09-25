-- The daily digest mailed to the user: when it last went out, and why the last attempt failed if it did.
ALTER TABLE "autopilot_control" ADD COLUMN "last_digest_at" TIMESTAMP(3),
ADD COLUMN "last_digest_error" TEXT;
