import assert from "node:assert/strict";
import test from "node:test";
import { ActivityType, ApplicationStage } from "../app/generated/prisma/enums";
import { startOfRange, summarizeDashboard } from "../services/dashboard-analytics";

const date = (value: string) => new Date(`${value}T12:00:00.000Z`);

test("dashboard summarizes unique jobs, conversions, pipeline, and performance", () => {
  const now = date("2026-08-21");
  const vendor = { id: "vendor-a", name: "Vendor A" };
  const opportunities = [
    {
      id: "job-a",
      title: "Role A",
      client: null,
      createdAt: date("2026-08-18"),
      vendor,
      recruiter: { id: "recruiter-a", name: "Recruiter A" },
      applicationTrack: { currentStage: ApplicationStage.SUBMITTED_TO_CLIENT },
      activities: [
        { type: ActivityType.OUTREACH_SENT, occurredAt: date("2026-08-18") },
        { type: ActivityType.RECRUITER_REPLY, occurredAt: date("2026-08-19") },
        { type: ActivityType.CALL, occurredAt: date("2026-08-20") },
        { type: ActivityType.CLIENT_SUBMISSION, occurredAt: date("2026-08-21") },
      ],
    },
    {
      id: "job-b",
      title: "Role B",
      client: null,
      createdAt: date("2026-08-01"),
      vendor,
      recruiter: { id: "recruiter-b", name: "Recruiter B" },
      applicationTrack: { currentStage: ApplicationStage.INTERVIEW_SCHEDULED },
      activities: [
        { type: ActivityType.OUTREACH_SENT, occurredAt: date("2026-08-17") },
        { type: ActivityType.INTERVIEW_SCHEDULED, occurredAt: date("2026-08-20") },
        { type: ActivityType.OFFER, occurredAt: date("2026-08-21") },
      ],
    },
    {
      id: "job-c",
      title: "Role C",
      client: null,
      createdAt: date("2026-08-21"),
      vendor: { id: "vendor-b", name: "Vendor B" },
      recruiter: null,
      applicationTrack: { currentStage: ApplicationStage.DISCOVERED },
      activities: [{ type: ActivityType.RECRUITER_REPLY, occurredAt: date("2026-08-21") }],
    },
  ];

  const result = summarizeDashboard(opportunities, "week", now);

  assert.equal(startOfRange("week", now)?.toISOString(), "2026-08-17T00:00:00.000Z");
  assert.deepEqual(result.counts, {
    total: 2,
    outreach: 2,
    replies: 2,
    calls: 1,
    rtr: 0,
    submitted: 1,
    interviews: 1,
    offers: 1,
  });
  assert.deepEqual(result.conversions.map(({ numerator, denominator }) => [numerator, denominator]), [
    [1, 2], [1, 2], [1, 2], [1, 2], [1, 1],
  ]);
  assert.deepEqual(result.pipeline.map((column) => column.jobs.map((job) => job.id)), [
    ["job-c"], [], [], ["job-a"], ["job-b"],
  ]);
  assert.equal(result.vendorPerformance[0]?.name, "Vendor A");
  assert.equal(result.vendorPerformance[0]?.offers, 1);
});
