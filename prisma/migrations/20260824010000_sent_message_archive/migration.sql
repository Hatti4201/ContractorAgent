-- The archived truth is what Outlook actually sent; the approved columns stay untouched for comparison.
ALTER TABLE "outreach_drafts" ADD COLUMN "sent_subject" TEXT;
ALTER TABLE "outreach_drafts" ADD COLUMN "sent_body" TEXT;
ALTER TABLE "outreach_drafts" ADD COLUMN "sent_to_address" TEXT;
