# Contractor Agent

Single-user web application for managing a human-reviewed contractor job workflow.

## Local setup

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env`; set the database URLs, a private app password, and a random session secret.
3. Generate the Prisma client: `npm run db:generate`
4. Apply migrations: `npx prisma migrate deploy`
5. Verify the current resume-routing data path: `npm run db:check:phase5`, then start with `npm run dev`.

The Phase 4 database check creates clearly fictional intake and CRM records inside one transaction, verifies draft isolation and duplicate detection, then rolls the transaction back. With a private `OPENAI_API_KEY` configured, `npm run ai:check:phase4` verifies fictional LinkedIn, direct email, and forwarded JD analysis without logging their output.

Resume files and outreach rules stay local because they contain personal information and are excluded from Git. Register an absolute PDF, DOCX, or DOC path from the authenticated `/resumes` page; the file must live outside this repository.

## Phase 5 boundary

Phase 5 adds a private six-family Resume Registry, file signature checks, deterministic high-confidence routing, and explicit low-confidence overrides. Inactive, missing, unreadable, mismatched-content, and repository-local files are blocked. AI never supplies attachment paths. Email generation, Outlook integration, and automated business-state changes remain excluded until their roadmap phases.
