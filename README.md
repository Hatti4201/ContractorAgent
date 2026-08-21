# Contractor Agent

Single-user web application for managing a human-reviewed contractor job workflow.

## Local setup

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env`; set the database URLs, a private app password, and a random session secret.
3. Generate the Prisma client: `npm run db:generate`
4. Apply migrations: `npx prisma migrate deploy`
5. Verify the current analytics data path: `npm run db:check:phase2`, then start with `npm run dev`.

The Phase 2 check creates clearly fictional CRM records inside one transaction, verifies filters, funnel metrics, conversion, and pipeline placement, then rolls the transaction back. It retains no sample business data.

Resume files and outreach rules stay local because they contain personal information and are excluded from Git.

## Phase 2 boundary

Phase 2 adds UTC time ranges, Role / Vendor / Recruiter / Stage / Employment filters, activity-backed metrics, conversion rates, a pipeline board, and performance tables. AI, Outlook integration, automated business-state changes, and reminder rules remain excluded until their roadmap phases.
