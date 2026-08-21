import { ActivityType, ApplicationStage } from "@/app/generated/prisma/enums";

type AttentionOpportunity = {
  id: string;
  title: string;
  client: string | null;
  recruiter: { name: string } | null;
  vendor: { name: string } | null;
  applicationTrack: {
    currentStage: ApplicationStage;
    waitingOn: string | null;
    nextAction: string | null;
    nextFollowUpAt: Date | null;
    attentionClearedAt: Date | null;
  } | null;
  activities: Array<{ type: ActivityType; occurredAt: Date }>;
};

export type AttentionItem = {
  jobId: string;
  title: string;
  client: string | null;
  stage: ApplicationStage;
  who: string;
  reason: string;
  nextAction: string;
  waitingOn: string | null;
  dueDate: string;
  daysOverdue: number;
};

const terminalStages = new Set<ApplicationStage>([
  ApplicationStage.HIRED,
  ApplicationStage.NO_RESPONSE,
  ApplicationStage.REJECTED,
  ApplicationStage.ROLE_CLOSED,
  ApplicationStage.WITHDRAWN,
  ApplicationStage.DUPLICATE,
]);

// ponytail: fixed single-user defaults; move these to settings only when tuning is needed.
const reminderDays = { outreach: 3, rtr: 2, submission: 5, interview: 1 } as const;

export function configuredTimeZone(value = process.env.APP_TIME_ZONE) {
  const timeZone = value?.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return timeZone;
  } catch {
    return "UTC";
  }
}

export function calendarDate(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function dayDifference(left: string, right: string) {
  return Math.floor((Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000);
}

function latestActivity(opportunity: AttentionOpportunity, type: ActivityType) {
  return opportunity.activities
    .filter((activity) => activity.type === type)
    .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())[0];
}

function hasLaterActivity(
  opportunity: AttentionOpportunity,
  occurredAt: Date,
  types: readonly ActivityType[],
) {
  return opportunity.activities.some(
    (activity) => activity.occurredAt > occurredAt && types.includes(activity.type),
  );
}

export function buildAttentionItems(
  opportunities: AttentionOpportunity[],
  now = new Date(),
  timeZone = configuredTimeZone(),
) {
  const today = calendarDate(now, timeZone);
  const items = opportunities.flatMap((opportunity): AttentionItem[] => {
    const track = opportunity.applicationTrack;
    if (!track || terminalStages.has(track.currentStage)) return [];

    const who = opportunity.recruiter?.name ?? opportunity.vendor?.name ?? opportunity.client ?? "Contact not set";
    const makeItem = (reason: string, nextAction: string, dueDate: string): AttentionItem[] => {
      if (dueDate > today) return [];
      return [{
        jobId: opportunity.id,
        title: opportunity.title,
        client: opportunity.client,
        stage: track.currentStage,
        who,
        reason,
        nextAction: track.nextAction ?? nextAction,
        waitingOn: track.waitingOn,
        dueDate,
        daysOverdue: dayDifference(today, dueDate),
      }];
    };

    if (track.nextFollowUpAt) {
      return makeItem(
        "Scheduled follow-up is due.",
        "Complete the scheduled follow-up.",
        track.nextFollowUpAt.toISOString().slice(0, 10),
      );
    }
    if (track.nextAction) return makeItem("Next action is ready.", track.nextAction, today);

    const afterClear = (occurredAt: Date) => !track.attentionClearedAt || occurredAt > track.attentionClearedAt;
    const eventReminder = (
      type: ActivityType,
      waitDays: number,
      reason: string,
      nextAction: string,
      handledBy: readonly ActivityType[],
    ) => {
      const activity = latestActivity(opportunity, type);
      if (!activity || !afterClear(activity.occurredAt) || hasLaterActivity(opportunity, activity.occurredAt, handledBy)) return [];
      return makeItem(reason, nextAction, addDays(calendarDate(activity.occurredAt, timeZone), waitDays));
    };

    const reply = eventReminder(
      ActivityType.RECRUITER_REPLY,
      0,
      "Recruiter replied and needs your response.",
      "Reply to the recruiter.",
      [ActivityType.CALL, ActivityType.RTR_RECEIVED, ActivityType.RTR_SIGNED, ActivityType.CLIENT_SUBMISSION, ActivityType.INTERVIEW_SCHEDULED, ActivityType.OFFER],
    );
    if (reply.length) return reply;

    if (track.currentStage === ApplicationStage.INTERVIEW_SCHEDULED) return eventReminder(
      ActivityType.INTERVIEW_SCHEDULED,
      reminderDays.interview,
      "Interview remains incomplete one day after scheduling.",
      "Confirm or record the interview outcome.",
      [ActivityType.INTERVIEW_COMPLETED, ActivityType.OFFER],
    );
    if (track.currentStage === ApplicationStage.OUTREACH_SENT) return eventReminder(
      ActivityType.OUTREACH_SENT,
      reminderDays.outreach,
      "No recruiter reply three days after outreach.",
      "Contact the recruiter.",
      [ActivityType.RECRUITER_REPLY, ActivityType.CALL, ActivityType.RTR_RECEIVED, ActivityType.RTR_SIGNED, ActivityType.CLIENT_SUBMISSION, ActivityType.INTERVIEW_SCHEDULED, ActivityType.OFFER],
    );
    if (track.currentStage === ApplicationStage.RTR_SIGNED) return eventReminder(
      ActivityType.RTR_SIGNED,
      reminderDays.rtr,
      "Client submission is not confirmed two days after RTR.",
      "Confirm client submission.",
      [ActivityType.CLIENT_SUBMISSION, ActivityType.INTERVIEW_SCHEDULED, ActivityType.OFFER],
    );
    if (track.currentStage === ApplicationStage.SUBMITTED_TO_CLIENT) return eventReminder(
      ActivityType.CLIENT_SUBMISSION,
      reminderDays.submission,
      "No update five days after client submission.",
      "Ask for a client update.",
      [ActivityType.RECRUITER_REPLY, ActivityType.CALL, ActivityType.INTERVIEW_SCHEDULED, ActivityType.INTERVIEW_COMPLETED, ActivityType.OFFER],
    );
    return [];
  });

  return items.sort((left, right) =>
    left.dueDate.localeCompare(right.dueDate) || left.title.localeCompare(right.title),
  );
}
