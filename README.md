# Contractor Agent

Single-user web application for managing a human-reviewed contractor job workflow.

## Local setup

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env`; set the database URLs, a private app password, and a random session secret.
3. Generate the Prisma client: `npm run db:generate`
4. Apply migrations: `npx prisma migrate deploy`
5. Verify Phase 1 relations: `npm run db:check:phase1`, then start with `npm run dev`.

The Phase 1 check creates a clearly fictional opportunity, recruiter, vendor, track, and activity inside one transaction, verifies their relations, then rolls the transaction back. It retains no sample business data.

Resume files and outreach rules stay local because they contain personal information and are excluded from Git.

## Phase 1 boundary

Phase 1 provides a password-protected, single-user Job → Recruiter → Stage → Timeline workflow. AI, Outlook integration, automated business-state changes, funnel analytics, and reminder rules remain excluded until their roadmap phases.
