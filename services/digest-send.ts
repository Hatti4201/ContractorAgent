import { AutoSendState, FollowUpStatus } from "@/app/generated/prisma/enums";
import { formatDateTime } from "@/lib/job-values";
import { getPrisma } from "@/lib/prisma";
import { calendarDate } from "@/services/attention";
import { appUrl, buildDigest, digestDue, digestEmpty, digestSettings, type DigestData } from "@/services/digest";
import { mailScanState } from "@/services/follow-up-scan";
import { queuedIntakes } from "@/services/intake-queue";
import { scanWindowFromEnv } from "@/services/mail-schedule";
import { outlookAccountAddress, outlookConnected, outlookSendToken } from "@/services/outlook-auth";
import { sendOutlookMail } from "@/services/outlook-graph";
import { unsentDraftFilter } from "@/services/outreach-pipeline";

const CONTROL_ID = "primary";
const DAY_MS = 24 * 60 * 60_000;

const jobSelection = { opportunityId: true, opportunity: { select: { title: true, recruiter: { select: { name: true } } } } } as const;
const job = (draft: { opportunityId: string; opportunity: { title: string; recruiter: { name: string } | null } }) => ({
  opportunityId: draft.opportunityId,
  title: draft.opportunity.title,
  recruiter: draft.opportunity.recruiter?.name ?? null,
});

export async function gatherDigest(since: Date): Promise<DigestData> {
  const database = getPrisma();
  const [sent, notSent, waiting, queue, followUps, scan] = await Promise.all([
    database.outreachDraft.findMany({ where: { autoSentAt: { gte: since } }, select: { ...jobSelection, autoSentAt: true }, orderBy: { autoSentAt: "asc" } }),
    database.outreachDraft.findMany({
      where: { autoSendState: { in: [AutoSendState.FAILED, AutoSendState.CANCELLED] }, updatedAt: { gte: since } },
      select: { ...jobSelection, autoSendError: true },
    }),
    // A draft already scheduled to send itself is not waiting on the user.
    database.outreachDraft.findMany({
      where: { ...unsentDraftFilter, NOT: { autoSendState: { in: [AutoSendState.SCHEDULED, AutoSendState.SENDING] } } },
      select: jobSelection,
      orderBy: { outlookDraftCreatedAt: "asc" },
    }),
    queuedIntakes(database),
    database.followUpSuggestion.count({ where: { status: { in: [FollowUpStatus.PENDING, FollowUpStatus.FAILED] } } }),
    mailScanState(),
  ]);
  return {
    since,
    sent: sent.map((draft) => ({ ...job(draft), at: draft.autoSentAt! })),
    notSent: notSent.map((draft) => ({ ...job(draft), reason: draft.autoSendError })),
    waitingInOutlook: waiting.map(job),
    needsInput: queue.filter((intake) => intake.state !== "ANALYZING").map((intake) => ({ intakeId: intake.id, title: intake.title, reason: intake.detail })),
    followUps,
    scanFailures: scan.consecutiveFailures,
    scanError: scan.lastError,
  };
}

/**
 * Builds and mails one digest covering everything since the last one. The attempt is recorded either
 * way, so a mailbox without Mail.Send reports its reason once on the dashboard instead of every tick.
 */
export async function sendDigest(now = new Date()) {
  const database = getPrisma();
  const control = await database.autopilotControl.findUnique({ where: { id: CONTROL_ID } });
  const since = control?.lastDigestAt ?? new Date(now.getTime() - DAY_MS);
  const record = (lastDigestError: string | null) => database.autopilotControl.upsert({
    where: { id: CONTROL_ID },
    create: { id: CONTROL_ID, lastDigestAt: now, lastDigestError },
    update: { lastDigestAt: now, lastDigestError },
  });

  const data = await gatherDigest(since);
  if (digestEmpty(data)) { await record(null); return { sent: false as const, reason: "Nothing to report." }; }
  try {
    const to = digestSettings().to ?? await outlookAccountAddress();
    if (!to) throw new Error("No address to send the digest to; set DIGEST_TO.");
    const { subject, html } = buildDigest(data, appUrl(), formatDateTime);
    await sendOutlookMail({ to, subject, html }, { accessToken: await outlookSendToken() });
    await record(null);
    return { sent: true as const, reason: null };
  } catch (error) {
    const reason = (error instanceof Error ? error.message : "The digest could not be sent.").slice(0, 500);
    await record(reason);
    return { sent: false as const, reason };
  }
}

/** One scheduler tick's worth: at most one digest per scan day, once its hour has come. */
export async function digestTick(now = new Date()) {
  const settings = digestSettings();
  if (!settings.enabled) return;
  const window = scanWindowFromEnv();
  const control = await getPrisma().autopilotControl.findUnique({ where: { id: CONTROL_ID }, select: { lastDigestAt: true } });
  const lastOn = control?.lastDigestAt ? calendarDate(control.lastDigestAt, window.timeZone) : null;
  if (!digestDue(now, lastOn, settings, window)) return;
  if (!await outlookConnected()) return;
  await sendDigest(now);
}

export async function lastDigestStatus() {
  return getPrisma().autopilotControl.findUnique({ where: { id: CONTROL_ID }, select: { lastDigestAt: true, lastDigestError: true } });
}
