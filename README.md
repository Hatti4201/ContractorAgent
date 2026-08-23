# Contractor Agent

Single-user web application for managing a human-reviewed contractor job workflow.

## Local setup

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env`; set the database URLs, a private app password, and a random session secret.
3. Generate the Prisma client: `npm run db:generate`
4. Apply migrations: `npx prisma migrate deploy`
5. Verify the current human-confirmed follow-up path: `npm run db:check:phase8`, then start with `npm run dev`.

Intake needs only the pasted text: source type, sender, and received time are detected from the text itself and stay correctable on the review screen before anything becomes CRM fact. The Phase 4 database check creates clearly fictional intake and CRM records inside one transaction, verifies draft isolation and duplicate detection, then rolls the transaction back. With a private `OPENAI_API_KEY` configured, `npm run ai:check:phase4` verifies fictional LinkedIn, direct email, and forwarded JD analysis without logging their output.

Resume files and outreach rules stay local because they contain personal information and are excluded from Git. Register an absolute PDF, DOCX, or DOC path from the authenticated `/resumes` page, and set `OUTREACH_CONTEXT_PATH` to the approved private candidate/outreach text file; both files must live outside this repository.

## Phase 7 boundary

Phase 7 uses Microsoft delegated OAuth with only `Mail.ReadWrite`, encrypted MSAL token-cache persistence, immutable Outlook message IDs, verified New/Reply drafts, and real Resume attachments up to 150 MB. The application never requests `Mail.Send` and contains no send endpoint. After the user sends in Outlook, the app verifies the immutable message, recipient, subject, and attachment before recording `OUTREACH_SENT`.

Register `MICROSOFT_REDIRECT_URI` as a **Web** redirect URI in Microsoft Entra, grant delegated `Mail.ReadWrite`, and do not grant `Mail.Send`. Set all Phase 7 environment values from `.env.example`, apply migrations, then connect from `/outlook`.

## Phase 8 boundary

Phase 8 scans at most 25 recent Inbox messages and analyzes at most 10 new messages per user-triggered scan. Only mail from a confirmed Recruiter or with a strong deterministic job-title match is analyzed. Full email bodies are not stored: the private database keeps the Outlook message ID, sender, subject, short exact evidence, confidence, and proposed CRM changes.

Every suggestion appears in `/needs-attention`. Retry, manual job linking, and dismissal do not change CRM business state. Only an explicit **Confirm proposed changes** action can update Activity, Stage, Waiting On, Next Action, or Follow-up Date, and the suggestion decision plus Activity timeline provide the audit trail.
