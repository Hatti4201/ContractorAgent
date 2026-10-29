import { ActivityType, ApplicationStage, AutoSendState } from "@/app/generated/prisma/enums";
import { getPrisma } from "@/lib/prisma";

export function isManualReplyAfterDraft(
  message: { direction: string; outlookMessageId: string; receivedAt: Date },
  draftCreatedAt: Date | null,
  draftMessageId: string | null,
) {
  return message.direction === "outgoing"
    && Boolean(draftCreatedAt)
    && message.receivedAt > draftCreatedAt!
    && message.outlookMessageId !== draftMessageId;
}

/** Stops one queued send and leaves the job in the existing manual-reply attention flow. */
export async function stopAutomaticSendAfterManualReply(opportunityId: string, database = getPrisma()) {
  return database.$transaction(async (transaction) => {
    const cancelled = await transaction.outreachDraft.updateMany({
      where: { opportunityId, autoSendState: { in: [AutoSendState.SCHEDULED, AutoSendState.SENDING] } },
      data: { autoSendState: AutoSendState.CANCELLED, autoSendError: "Automatic follow-up stopped because you replied manually in Outlook." },
    });
    if (cancelled.count !== 1) return false;

    const track = await transaction.applicationTrack.findUnique({ where: { opportunityId }, select: { currentStage: true } });
    if (track && (track.currentStage === ApplicationStage.DISCOVERED || track.currentStage === ApplicationStage.OUTREACH_SENT || track.currentStage === ApplicationStage.RECRUITER_ENGAGED)) {
      await transaction.applicationTrack.update({
        where: { opportunityId },
        data: { ...(track.currentStage !== ApplicationStage.RECRUITER_ENGAGED ? { currentStage: ApplicationStage.RECRUITER_ENGAGED } : {}), waitingOn: "Recruiter", nextAction: "Continue from your manual Outlook reply" },
      });
    }
    await transaction.activity.create({
      data: { opportunityId, type: ActivityType.RECRUITER_REPLY, description: "Manual Outlook reply detected; job marked Contacted and autopilot stopped." },
    });
    return true;
  });
}
