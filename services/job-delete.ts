import { AutoSendState } from "@/app/generated/prisma/enums";
import { getPrisma } from "@/lib/prisma";
import { draftToRemove, sameDeletedJob } from "@/services/job-delete-rules";
import { outlookAccessToken } from "@/services/outlook-auth";
import { outlookDraftStatus, removeOutlookDraftMessage } from "@/services/outlook-graph";

/** An email for the job is leaving Outlook this minute; deleting now could race the send. */
export class JobSendingError extends Error {}

/** What became of the job's email in Outlook: removed, never there, or left for the user. */
export type OutlookCleanup = "deleted" | "none" | "kept";

/**
 * Deletes a job with everything under it: its queued send is cancelled, its unsent Outlook draft is
 * removed, and the JD with its recruiter is remembered so it does not come back in. Outlook being
 * unreachable does not stop the delete; the draft is then reported as kept.
 */
export async function deleteJob(id: string): Promise<{ outlook: OutlookCleanup }> {
  const database = getPrisma();
  // Cancelled first, so the sender cannot claim the draft while Outlook is being cleaned up.
  await database.outreachDraft.updateMany({
    where: { opportunityId: id, autoSendState: AutoSendState.SCHEDULED },
    data: { autoSendState: AutoSendState.CANCELLED, autoSendError: "The job was deleted." },
  });
  const opportunity = await database.opportunity.findUnique({
    where: { id },
    select: {
      title: true,
      jdFingerprint: true,
      recruiter: { select: { email: true } },
      outreachDraft: { select: { outlookMessageId: true, outlookState: true, autoSendState: true, sentConfirmedAt: true } },
    },
  });
  if (!opportunity) return { outlook: "none" };
  const draft = opportunity.outreachDraft;
  if (draft?.autoSendState === AutoSendState.SENDING) throw new JobSendingError("Its email is being sent right now; try again in a minute.");

  let outlook: OutlookCleanup = "none";
  if (draft && draftToRemove(draft)) {
    try {
      const options = { accessToken: await outlookAccessToken() };
      const status = await outlookDraftStatus(draft.outlookMessageId!, options);
      if (status === "DRAFT") {
        await removeOutlookDraftMessage(draft.outlookMessageId!, options);
        outlook = "deleted";
      }
    } catch {
      outlook = "kept";
    }
  }

  await database.$transaction([
    ...(opportunity.jdFingerprint ? [database.deletedJob.create({
      data: { jdFingerprint: opportunity.jdFingerprint, recruiterEmail: opportunity.recruiter?.email?.trim().toLowerCase() || null, title: opportunity.title },
    })] : []),
    database.opportunity.delete({ where: { id } }),
  ]);
  return { outlook };
}

/**
 * The deleted job this source repeats, if any: the same JD text, sent by the same recruiter. A record
 * with no recruiter matches on the JD alone, since it may be that same person.
 */
export async function deletedBefore(fingerprint: string, rawText: string, recruiterEmail: string | null) {
  const records = await getPrisma().deletedJob.findMany({ where: { jdFingerprint: fingerprint }, orderBy: { deletedAt: "desc" } });
  return records.find((record) => sameDeletedJob(record.recruiterEmail, rawText, recruiterEmail)) ?? null;
}
