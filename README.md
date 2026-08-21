# Contractor Agent

Single-user web application for managing a human-reviewed contractor job workflow.

## Local setup

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env`; set the database URLs, a private app password, and a random session secret.
3. Generate the Prisma client: `npm run db:generate`
4. Apply migrations: `npx prisma migrate deploy`
5. Verify the current follow-up data path: `npm run db:check:phase3`, then start with `npm run dev`.

The Phase 3 check creates a clearly fictional CRM record inside one transaction, verifies reminder creation and completion, then rolls the transaction back. It retains no sample business data.

Resume files and outreach rules stay local because they contain personal information and are excluded from Git.

## Phase 3 boundary

Phase 3 adds timezone-aware Needs Attention rules for scheduled work, Outreach, recruiter replies, RTR, Client Submission, and Interview follow-up. Users complete or reschedule reminders from Job Detail, and every action remains in the Activity timeline. AI, Outlook integration, and automated business-state changes remain excluded until their roadmap phases.
