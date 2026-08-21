# Contractor Agent

Single-user web application for managing a human-reviewed contractor job workflow.

## Local setup

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env` and set the PostgreSQL/Supabase URLs.
3. Generate the Prisma client: `npm run db:generate`
4. Verify database reads and writes: `npm run db:check`
5. Start the app: `npm run dev`

The database check creates a temporary table inside one transaction, writes and reads a random marker, then drops the table automatically. It does not retain business data.

Resume files and outreach rules stay local because they contain personal information and are excluded from Git.

## Phase boundary

Phase 0 contains only the web and database foundation. AI, job tracking, Outlook integration, and automated business-state changes are intentionally excluded until their roadmap phases.
