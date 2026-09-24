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

Phase 7 uses Microsoft delegated OAuth with `Mail.ReadWrite`, encrypted MSAL token-cache persistence, immutable Outlook message IDs, verified New/Reply drafts, and real Resume attachments up to 150 MB. `Mail.Send` is requested only while `AUTOPILOT=send` (see Automatic sending); in every other mode the user sends from Outlook. After a send, the app verifies the immutable message, recipient, subject, and attachment before recording `OUTREACH_SENT`.

Register `MICROSOFT_REDIRECT_URI` as a **Web** redirect URI in Microsoft Entra and grant delegated `Mail.ReadWrite`; add delegated `Mail.Send` only to use automatic sending. Set all Phase 7 environment values from `.env.example`, apply migrations, then connect from `/outlook`.

## Background tasks

Every step that calls a model or Microsoft Graph runs as a background task, so no page holds you while
it works. Pasting a job description returns immediately and the analysis, resume routing, drafting and
validation all run behind the page; a tray in the corner reports progress, failures, and a link to the
result. Tasks live in the server process, so stopping the server abandons whatever is running: any task
still marked running after fifteen minutes is reported as interrupted and can be started again.

## Scheduled mail scan

While the server runs, the Outlook scan repeats on a schedule set by `MAIL_SCAN_*` in the environment:
by default Monday to Friday, 06:00 to 15:00 in `APP_TIME_ZONE`, once an hour. `APP_TIME_ZONE` must be a
real IANA name such as `America/Los_Angeles`; an unrecognised value silently falls back to UTC and
takes follow-up due dates with it. Set `MAIL_SCAN_ENABLED=false` to turn the schedule off; the manual
button on Needs attention runs the same code either way.

Each scan asks Microsoft Graph only for mail newer than the last message it decided on, so a run that
finds nothing new costs no model call, and the watermark advances only past messages that run actually
handled. The schedule is a timer inside the server process: stopping the server stops it, and it
resumes on the next tick after a restart rather than firing a burst of missed scans. Repeated failures
are counted and reported on Needs attention, because an unattended scan must not fail quietly.

## Autopilot

With `MAIL_INTAKE_SCAN=on` and `AUTOPILOT=draft`, a job the scan imports from Outlook goes all the way to
a verified Outlook reply draft with the resume attached, and no click. The pipeline takes the first
usable resume when several share a role family, and when the validator objects it rewrites the email
once with the objections as feedback. Non-blocking notes that survive the rewrite are accepted; the
first email only has to get the resume in front of the recruiter.

Every intake is also scored against the approved candidate context. The requirement list comes from
the analysis (required skills, years, and any work authorization, clearance, local or relocation
requirement); the model judges each item and must quote the context for it, and a verdict whose quote is
not really in the context is downgraded. The score is computed from those verdicts, not picked by the
model: MET counts 1, PARTIAL half, over the skills. It shows on the review screen, the job page and the
queue. In place of the review path's 70% analysis-confidence gate, the autopilot accepts 50% and lets the
score decide.

The autopilot holds instead, and the source stays under **Waiting for your review** with the reason,
when there is no recruiter email, no usable resume, no job title, the match is below `MATCH_THRESHOLD`
(default 50%), the context itself states a conflict with an eligibility requirement, the same JD (or a
similar title from the same recruiter) is already tracked, or a BLOCK issue — wrong recipient or attachment, or a claim
about the candidate the approved context does not support — survives the rewrite. Pasted text never
rides the autopilot.

## Automatic sending

`AUTOPILOT` goes `off` → `draft` → `shadow` → `send`, one step at a time:

- **shadow** builds drafts exactly like `draft`, and records for each one when it would have been sent.
  The Autopilot panel on the dashboard shows, for the last 7 days, how many the autopilot would have
  sent and how many of those you sent yourself. Run it for a week; if you sent nearly all of them and
  rarely changed a word, move on.
- **send** sends each draft the autopilot built `AUTO_SEND_DELAY_MINUTES` (default 10) after building
  it, at most `AUTO_SEND_DAILY_LIMIT` (default 20) in any rolling 24 hours. Until then it shows under
  **About to send** with a **Don't send** link, and **Pause all sending** stops everything without a
  restart. It sends the draft as it stands in Outlook, so an edit you make there in the window goes too.

Right before each send the draft is re-checked: still approved, recipient, resume and private context
unchanged, and still a draft in Outlook (one you already sent or deleted is left alone). Anything that
fails a check stays in Outlook for you and is never retried; a send that was claimed but never
confirmed is reported, not repeated, so nothing goes twice. Sends run on the scheduler's five-minute
tick, so they need `MAIL_SCAN_ENABLED`; outside the scan window only a send that fell due in the last
hour goes, and anything older waits for the next window rather than reaching a recruiter at night.

To enable it, add delegated `Mail.Send` to the app registration in Microsoft Entra, set `AUTOPILOT=send`,
restart, then disconnect and reconnect Outlook so the new permission is granted. Without the grant,
reading and drafting keep working and only the sends fail, each with that reason.

## Employer copy

A C2C engagement copies the employer by default. The address comes only from `EMPLOYER_CC_ADDRESS` in the
local environment, never from the model, and it is shown with a checkbox on the outreach screen so it can
be cleared before any Outlook draft exists. Outlook draft creation verifies the copy landed exactly as
approved, and refuses a draft carrying a copy nobody approved. Leave the setting unset to never copy anyone.

## Outreach formatting

Outreach bodies are stored as plain text and may use Markdown `**bold**` as their only markup. The Outlook draft body is built by escaping the saved text first and then converting that one marker, so the recruiter's screening labels arrive in bold and nothing else in a model-written body can become markup. The outreach screen shows the converted result as an Outlook preview before approval.

## Phase 8 boundary

Phase 8 scans at most 25 recent Inbox messages and analyzes at most 10 new messages per user-triggered scan. Only mail from a confirmed Recruiter or with a strong deterministic job-title match is analyzed. Full email bodies are not stored: the private database keeps the Outlook message ID, sender, subject, short exact evidence, confidence, and proposed CRM changes.

Every suggestion appears in `/needs-attention`. Retry, manual job linking, and dismissal do not change CRM business state. Only an explicit **Confirm proposed changes** action can update Activity, Stage, Waiting On, Next Action, or Follow-up Date, and the suggestion decision plus Activity timeline provide the audit trail.
