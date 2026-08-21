import assert from "node:assert/strict";
import test from "node:test";
import { ActivityType, ApplicationStage } from "../app/generated/prisma/enums";
import { buildAttentionItems, configuredTimeZone } from "../services/attention";

type Opportunity = Parameters<typeof buildAttentionItems>[0][number];
const date = (value: string) => new Date(value.includes("T") ? value : `${value}T12:00:00.000Z`);

function opportunity(
  id: string,
  stage: ApplicationStage,
  activities: Opportunity["activities"] = [],
  track: Partial<NonNullable<Opportunity["applicationTrack"]>> = {},
): Opportunity {
  return {
    id,
    title: id,
    client: "Sample client",
    recruiter: { name: "Sample recruiter" },
    vendor: null,
    applicationTrack: {
      currentStage: stage,
      waitingOn: null,
      nextAction: null,
      nextFollowUpAt: null,
      attentionClearedAt: null,
      ...track,
    },
    activities,
  };
}

test("attention rules include due work and suppress future, terminal, handled, and completed work", () => {
  const activity = (type: ActivityType, day: string) => ({ type, occurredAt: date(day) });
  const rows = [
    opportunity("scheduled", ApplicationStage.DISCOVERED, [], { nextFollowUpAt: date("2026-08-21") }),
    opportunity("next-action", ApplicationStage.DISCOVERED, [], { nextAction: "Review the sample." }),
    opportunity("reply", ApplicationStage.RECRUITER_ENGAGED, [activity(ActivityType.RECRUITER_REPLY, "2026-08-21")]),
    opportunity("outreach", ApplicationStage.OUTREACH_SENT, [activity(ActivityType.OUTREACH_SENT, "2026-08-18")]),
    opportunity("rtr", ApplicationStage.RTR_SIGNED, [activity(ActivityType.RTR_SIGNED, "2026-08-19")]),
    opportunity("submission", ApplicationStage.SUBMITTED_TO_CLIENT, [activity(ActivityType.CLIENT_SUBMISSION, "2026-08-16")]),
    opportunity("interview", ApplicationStage.INTERVIEW_SCHEDULED, [activity(ActivityType.INTERVIEW_SCHEDULED, "2026-08-20")]),
    opportunity("future", ApplicationStage.OUTREACH_SENT, [activity(ActivityType.OUTREACH_SENT, "2026-08-01")], { nextFollowUpAt: date("2026-08-22") }),
    opportunity("terminal", ApplicationStage.REJECTED, [activity(ActivityType.OUTREACH_SENT, "2026-08-01")]),
    opportunity("cleared", ApplicationStage.OUTREACH_SENT, [activity(ActivityType.OUTREACH_SENT, "2026-08-18")], { attentionClearedAt: date("2026-08-20") }),
    opportunity("handled-interview", ApplicationStage.INTERVIEW_SCHEDULED, [
      activity(ActivityType.INTERVIEW_SCHEDULED, "2026-08-19"),
      activity(ActivityType.INTERVIEW_COMPLETED, "2026-08-20"),
    ]),
  ];

  const result = buildAttentionItems(rows, date("2026-08-21"), "UTC");
  assert.deepEqual(result.map((item) => item.jobId).sort(), [
    "interview", "next-action", "outreach", "reply", "rtr", "scheduled", "submission",
  ]);
  assert.equal(result.find((item) => item.jobId === "outreach")?.daysOverdue, 0);
  assert.equal(result.find((item) => item.jobId === "scheduled")?.nextAction, "Complete the scheduled follow-up.");
});

test("follow-up calendar dates use the configured timezone", () => {
  const row = opportunity("timezone", ApplicationStage.DISCOVERED, [], {
    nextFollowUpAt: date("2026-08-22"),
  });
  const now = date("2026-08-22T02:00:00.000Z");

  assert.equal(buildAttentionItems([row], now, "Pacific/Honolulu").length, 0);
  assert.equal(buildAttentionItems([row], now, "UTC").length, 1);
  assert.equal(configuredTimeZone("Not/A_Timezone"), "UTC");
});
