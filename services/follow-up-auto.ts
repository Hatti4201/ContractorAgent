import type { Prisma } from "@/app/generated/prisma/client";
import { ActivityType } from "@/app/generated/prisma/enums";

/** Off unless the user turned it on, which RESTRICTIONS §4 requires of any automatic update. */
export function followUpAutoEnabled(value = process.env.FOLLOW_UP_AUTO) {
  return value?.trim().toLowerCase() === "on";
}

/** Below this the email is not understood well enough to move a date without being asked. */
export const AUTO_CONFIDENCE = 0.8;

export type AutoCandidate = {
  opportunityId: string | null;
  confidence: number | null;
  proposedWaitingOn: string | null;
  proposedNextAction: string | null;
  proposedNextFollowUpAt: Date | null;
  followUpAppliedAt: Date | null;
};

/**
 * Stage is deliberately absent: §4 still reserves it for the user. What may move on its own is the
 * follow-up state, and only when the email was matched to one opportunity and understood clearly.
 */
export function shouldApplyFollowUp(candidate: AutoCandidate, enabled = followUpAutoEnabled()) {
  if (!enabled || !candidate.opportunityId || candidate.followUpAppliedAt) return false;
  if (candidate.confidence === null || candidate.confidence < AUTO_CONFIDENCE) return false;
  // Nothing proposed is nothing to apply; the suggestion still waits for the user on its own merits.
  return Boolean(candidate.proposedWaitingOn || candidate.proposedNextAction || candidate.proposedNextFollowUpAt);
}

export function autoFollowUpDescription(candidate: AutoCandidate) {
  const parts = [
    candidate.proposedWaitingOn ? `waiting on ${candidate.proposedWaitingOn}` : null,
    candidate.proposedNextAction ? `next action "${candidate.proposedNextAction}"` : null,
    candidate.proposedNextFollowUpAt ? `follow-up ${candidate.proposedNextFollowUpAt.toISOString().slice(0, 10)}` : null,
  ].filter(Boolean);
  return `Follow-up updated from a recruiter email without confirmation: ${parts.join(", ")}. Stage is unchanged and the suggestion still waits for you.`;
}

/**
 * Writes the three fields and the Activity that RESTRICTIONS §4 requires of every automatic update.
 * The suggestion stays pending, because the Stage it proposes is still the user's to accept.
 */
export async function applyFollowUp(
  database: Prisma.TransactionClient,
  suggestionId: string,
  candidate: AutoCandidate & { opportunityId: string },
  occurredAt: Date,
) {
  await database.applicationTrack.update({
    where: { opportunityId: candidate.opportunityId },
    data: {
      waitingOn: candidate.proposedWaitingOn,
      nextAction: candidate.proposedNextAction,
      nextFollowUpAt: candidate.proposedNextFollowUpAt,
      attentionClearedAt: null,
    },
  });
  await database.activity.create({
    data: {
      opportunityId: candidate.opportunityId,
      type: ActivityType.NOTE,
      description: autoFollowUpDescription(candidate),
      occurredAt,
    },
  });
  await database.followUpSuggestion.update({ where: { id: suggestionId }, data: { followUpAppliedAt: new Date() } });
}
