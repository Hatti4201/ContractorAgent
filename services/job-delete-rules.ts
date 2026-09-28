import { AutoSendState, OutlookDraftState } from "@/app/generated/prisma/enums";
import { addressIn } from "@/services/autopilot";

/**
 * A draft is removed from Outlook only while it is still a draft there. One the user already sent,
 * by hand or by the autopilot, is part of their Sent Items and is never touched.
 */
export function draftToRemove(draft: { outlookMessageId: string | null; outlookState: OutlookDraftState; autoSendState: AutoSendState | null; sentConfirmedAt: Date | null }) {
  return Boolean(draft.outlookMessageId)
    && draft.outlookState !== OutlookDraftState.SENT
    && draft.autoSendState !== AutoSendState.SENT
    && !draft.sentConfirmedAt;
}

/** Whether a source repeats a deleted job's recruiter: named in the text, or found by the analysis. */
export function sameDeletedJob(deletedEmail: string | null, rawText: string, recruiterEmail: string | null) {
  if (!deletedEmail) return true;
  return recruiterEmail?.trim().toLowerCase() === deletedEmail || addressIn(rawText, deletedEmail);
}
