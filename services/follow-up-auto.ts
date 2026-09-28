import type { Prisma } from "@/app/generated/prisma/client";
import { ActivityType, ApplicationStage, FollowUpStatus } from "@/app/generated/prisma/enums";
import { parseFollowUpEvidence, stageRank } from "@/services/follow-up";

/** Off unless the user turned it on, which RESTRICTIONS §4 requires of any automatic update. */
export function followUpAutoEnabled(value = process.env.FOLLOW_UP_AUTO) {
  return value?.trim().toLowerCase() === "on";
}

/** The Stage half has its own switch: RESTRICTIONS 1.7 §4 wants the two closable separately. */
export function followUpAutoStageEnabled(value = process.env.FOLLOW_UP_AUTO_STAGE) {
  return value?.trim().toLowerCase() === "on";
}

/** Below this the email is not understood well enough to move anything without being asked. */
export const AUTO_CONFIDENCE = 0.8;

/** RESTRICTIONS 1.7 §4: only these forward moves; REJECTED and ROLE_CLOSED stay the user's to confirm. */
export const AUTO_STAGES = new Set<ApplicationStage>([
  ApplicationStage.RECRUITER_ENGAGED,
  ApplicationStage.SUBMITTED_TO_CLIENT,
  ApplicationStage.INTERVIEW_SCHEDULED,
  ApplicationStage.INTERVIEW_COMPLETED,
  ApplicationStage.OFFER,
]);

export type AutoCandidate = {
  opportunityId: string | null;
  confidence: number | null;
  proposedWaitingOn: string | null;
  proposedNextAction: string | null;
  proposedNextFollowUpAt: Date | null;
  followUpAppliedAt: Date | null;
};

export type AutoSuggestion = AutoCandidate & {
  id: string;
  receivedAt: Date;
  proposedActivity: ActivityType | null;
  proposedStage: ApplicationStage | null;
  evidence: unknown;
};

function confidentMatch(candidate: AutoCandidate) {
  return Boolean(candidate.opportunityId) && candidate.confidence !== null && candidate.confidence >= AUTO_CONFIDENCE;
}

function proposesFollowUp(candidate: AutoCandidate) {
  return Boolean(candidate.proposedWaitingOn || candidate.proposedNextAction || candidate.proposedNextFollowUpAt);
}

/** The follow-up fields move only when the email was matched to one opportunity and understood clearly. */
export function shouldApplyFollowUp(candidate: AutoCandidate, enabled = followUpAutoEnabled()) {
  if (!enabled || candidate.followUpAppliedAt || !confidentMatch(candidate)) return false;
  // Nothing proposed is nothing to apply.
  return proposesFollowUp(candidate);
}

/** A Stage moves on its own only forward, into an allowed stage, and with evidence quoted from the email. */
export function shouldApplyStage(candidate: AutoSuggestion, currentStage: ApplicationStage, enabled = followUpAutoStageEnabled()) {
  const target = candidate.proposedStage;
  if (!enabled || !target || !AUTO_STAGES.has(target) || !confidentMatch(candidate)) return false;
  if (!parseFollowUpEvidence(candidate.evidence).length) return false;
  // An unranked current stage (terminal, or anything off the ladder) never moves on its own.
  return (stageRank[target] ?? -1) > (stageRank[currentStage] ?? Number.POSITIVE_INFINITY);
}

export function autoFollowUpDescription(candidate: AutoCandidate) {
  const parts = [
    candidate.proposedWaitingOn ? `waiting on ${candidate.proposedWaitingOn}` : null,
    candidate.proposedNextAction ? `next action "${candidate.proposedNextAction}"` : null,
    candidate.proposedNextFollowUpAt ? `follow-up ${candidate.proposedNextFollowUpAt.toISOString().slice(0, 10)}` : null,
  ].filter(Boolean);
  return `Follow-up updated from a recruiter email without confirmation: ${parts.join(", ")}.`;
}

// ponytail: the Timeline's undo reads the stages back out of this sentence, so no column holds them.
// Change the wording and parseAutoStageChange together, or old entries lose their undo button.
const autoStagePattern = /^Stage changed from ([A-Z_]+) to ([A-Z_]+) automatically from Outlook follow-up suggestion \S+\.$/;

export function autoStageDescription(from: ApplicationStage, to: ApplicationStage, suggestionId: string) {
  return `Stage changed from ${from} to ${to} automatically from Outlook follow-up suggestion ${suggestionId}.`;
}

export function parseAutoStageChange(description: string) {
  const match = autoStagePattern.exec(description);
  const stages = Object.values(ApplicationStage) as string[];
  if (!match || !stages.includes(match[1]) || !stages.includes(match[2])) return null;
  return { from: match[1] as ApplicationStage, to: match[2] as ApplicationStage };
}

/** The CORRECTION an undo writes; it names the activity it undoes so the same one cannot be undone twice. */
export function undoAutoStageDescription(activityId: string, change: { from: ApplicationStage; to: ApplicationStage }) {
  return `Undid automatic stage change ${activityId}: stage moved back from ${change.to} to ${change.from}.`;
}

/**
 * Applies what the switches allow, each part with the Activity RESTRICTIONS §4 requires. When every
 * part the email proposed was applied, nothing is left for the user and the suggestion leaves the queue;
 * otherwise it stays pending with whatever is left (a terminal Stage, a low-confidence reading).
 */
export async function applyAutomatically(
  database: Prisma.TransactionClient,
  suggestion: AutoSuggestion,
  switches = { fields: followUpAutoEnabled(), stage: followUpAutoStageEnabled() },
) {
  const none = { fields: false, stage: false, resolved: false };
  if (!suggestion.opportunityId || (!switches.fields && !switches.stage)) return none;
  const opportunityId = suggestion.opportunityId;
  const track = await database.applicationTrack.findUnique({ where: { opportunityId }, select: { currentStage: true } });
  if (!track) return none;

  const fields = shouldApplyFollowUp(suggestion, switches.fields);
  const stage = shouldApplyStage(suggestion, track.currentStage, switches.stage);
  const resolved = confidentMatch(suggestion)
    && (fields || !proposesFollowUp(suggestion))
    && (stage || !suggestion.proposedStage);
  const activities: Prisma.ActivityCreateManyInput[] = [];

  if (fields || stage) {
    await database.applicationTrack.update({
      where: { opportunityId },
      data: {
        ...(fields ? {
          waitingOn: suggestion.proposedWaitingOn,
          nextAction: suggestion.proposedNextAction,
          nextFollowUpAt: suggestion.proposedNextFollowUpAt,
        } : {}),
        ...(stage ? { currentStage: suggestion.proposedStage! } : {}),
        attentionClearedAt: null,
      },
    });
  }
  if (fields) activities.push({ opportunityId, type: ActivityType.NOTE, description: autoFollowUpDescription(suggestion), occurredAt: suggestion.receivedAt });
  if (resolved && suggestion.proposedActivity) activities.push({
    opportunityId,
    type: suggestion.proposedActivity,
    description: `Recorded automatically from Outlook follow-up suggestion ${suggestion.id}.`,
    occurredAt: suggestion.receivedAt,
  });
  if (stage) activities.push({
    opportunityId,
    type: ActivityType.STAGE_CHANGED,
    description: autoStageDescription(track.currentStage, suggestion.proposedStage!, suggestion.id),
    occurredAt: suggestion.receivedAt,
  });
  if (activities.length) await database.activity.createMany({ data: activities });

  if (fields || resolved) {
    await database.followUpSuggestion.update({
      where: { id: suggestion.id },
      data: {
        ...(fields ? { followUpAppliedAt: new Date() } : {}),
        // Nothing written means the email proposed no change at all: dismissed rather than confirmed.
        ...(resolved ? { status: activities.length ? FollowUpStatus.CONFIRMED : FollowUpStatus.DISMISSED, decidedAt: new Date() } : {}),
      },
    });
  }
  return { fields, stage, resolved };
}
