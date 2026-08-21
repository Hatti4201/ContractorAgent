# Contractor Agent

Single-user web application for managing a human-reviewed contractor job workflow.

## Local setup

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env`; set the database URLs, a private app password, and a random session secret.
3. Generate the Prisma client: `npm run db:generate`
4. Apply migrations: `npx prisma migrate deploy`
5. Verify the current outreach-draft data path: `npm run db:check:phase6`, then start with `npm run dev`.

The Phase 4 database check creates clearly fictional intake and CRM records inside one transaction, verifies draft isolation and duplicate detection, then rolls the transaction back. With a private `OPENAI_API_KEY` configured, `npm run ai:check:phase4` verifies fictional LinkedIn, direct email, and forwarded JD analysis without logging their output.

Resume files and outreach rules stay local because they contain personal information and are excluded from Git. Register an absolute PDF, DOCX, or DOC path from the authenticated `/resumes` page, and set `OUTREACH_CONTEXT_PATH` to the approved private candidate/outreach text file; both files must live outside this repository.

## Phase 6 boundary

Phase 6 adds four-mode outreach previews, strict structured generation, an independent candidate-fact Validator, edit/regenerate/approve review, and attachment rechecks. Both OpenAI calls use `store: false`; recipient and attachment selection remain deterministic. No Outlook draft is created, no email is sent, and CRM stage is unchanged until later phases.
