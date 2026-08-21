import { ActivityType, ApplicationStage } from "@/app/generated/prisma/enums";

export const timeRanges = ["today", "week", "month", "all"] as const;
export type TimeRange = (typeof timeRanges)[number];

export const dashboardMetrics = [
  { key: "total", label: "Total opportunities", types: [] },
  { key: "outreach", label: "Outreach sent", types: [ActivityType.OUTREACH_SENT] },
  { key: "replies", label: "Recruiter replies", types: [ActivityType.RECRUITER_REPLY] },
  { key: "calls", label: "Recruiter calls", types: [ActivityType.CALL] },
  { key: "rtr", label: "RTR signed", types: [ActivityType.RTR_SIGNED] },
  { key: "submitted", label: "Client submitted", types: [ActivityType.CLIENT_SUBMISSION] },
  {
    key: "interviews",
    label: "Interviews",
    types: [ActivityType.INTERVIEW_SCHEDULED, ActivityType.INTERVIEW_COMPLETED],
  },
  { key: "offers", label: "Offers", types: [ActivityType.OFFER] },
] as const;

export type DashboardMetricKey = (typeof dashboardMetrics)[number]["key"];

export type DashboardOpportunity = {
  id: string;
  title: string;
  client: string | null;
  createdAt: Date;
  vendor: { id: string; name: string } | null;
  recruiter: { id: string; name: string } | null;
  applicationTrack: { currentStage: ApplicationStage } | null;
  activities: Array<{ type: ActivityType; occurredAt: Date }>;
};

function includesActivity(types: readonly ActivityType[], type: ActivityType) {
  return types.includes(type);
}

type PerformanceRow = {
  id: string;
  name: string;
  total: number;
  outreach: number;
  replies: number;
  calls: number;
  rtr: number;
  submitted: number;
  interviews: number;
  offers: number;
};

export function startOfRange(range: TimeRange, now = new Date()) {
  if (range === "all") return null;
  if (range === "month") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (range === "week") start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  return start;
}

function intersectionSize(left: Set<string>, right: Set<string>) {
  let size = 0;
  for (const value of left) if (right.has(value)) size += 1;
  return size;
}

function performance(
  opportunities: DashboardOpportunity[],
  metricSets: Record<DashboardMetricKey, Set<string>>,
  contact: "vendor" | "recruiter",
) {
  const rows = new Map<string, PerformanceRow>();
  for (const opportunity of opportunities) {
    const owner = opportunity[contact];
    if (!owner) continue;
    const row = rows.get(owner.id) ?? {
      id: owner.id,
      name: owner.name,
      total: 0,
      outreach: 0,
      replies: 0,
      calls: 0,
      rtr: 0,
      submitted: 0,
      interviews: 0,
      offers: 0,
    };
    for (const metric of dashboardMetrics) {
      if (metricSets[metric.key].has(opportunity.id)) row[metric.key] += 1;
    }
    rows.set(owner.id, row);
  }

  return [...rows.values()]
    .filter((row) => dashboardMetrics.some((metric) => row[metric.key] > 0))
    .sort((a, b) =>
      b.offers - a.offers ||
      b.interviews - a.interviews ||
      b.submitted - a.submitted ||
      b.replies - a.replies ||
      b.outreach - a.outreach ||
      a.name.localeCompare(b.name),
    );
}

export function summarizeDashboard(
  opportunities: DashboardOpportunity[],
  range: TimeRange,
  now = new Date(),
) {
  const start = startOfRange(range, now);
  const inRange = (date: Date) => !start || date >= start;
  const metricSets = Object.fromEntries(
    dashboardMetrics.map((metric) => [metric.key, new Set<string>()]),
  ) as Record<DashboardMetricKey, Set<string>>;

  for (const opportunity of opportunities) {
    if (inRange(opportunity.createdAt)) metricSets.total.add(opportunity.id);
    for (const metric of dashboardMetrics) {
      if (metric.key !== "total" && opportunity.activities.some(
        (activity) => inRange(activity.occurredAt) && includesActivity(metric.types, activity.type),
      )) metricSets[metric.key].add(opportunity.id);
    }
  }

  const conversion = (
    label: string,
    source: DashboardMetricKey,
    target: DashboardMetricKey,
  ) => {
    const denominator = metricSets[source].size;
    const numerator = intersectionSize(metricSets[source], metricSets[target]);
    return { label, numerator, denominator, rate: denominator ? numerator / denominator : null };
  };

  const pipelineDefinitions = [
    { key: "outreach", label: "Outreach", stages: [ApplicationStage.DISCOVERED, ApplicationStage.OUTREACH_SENT] },
    { key: "engaged", label: "Engaged", stages: [ApplicationStage.RECRUITER_ENGAGED] },
    { key: "rtr", label: "RTR", stages: [ApplicationStage.RTR_SIGNED] },
    { key: "submitted", label: "Submitted", stages: [ApplicationStage.SUBMITTED_TO_CLIENT] },
    {
      key: "interview",
      label: "Interview",
      stages: [ApplicationStage.INTERVIEW_SCHEDULED, ApplicationStage.INTERVIEW_COMPLETED, ApplicationStage.OFFER],
    },
  ] as const;

  const details = Object.fromEntries(dashboardMetrics.map((metric) => [
    metric.key,
    opportunities.flatMap((opportunity) => {
      if (!metricSets[metric.key].has(opportunity.id)) return [];
      if (metric.key === "total") return [{
        jobId: opportunity.id,
        title: opportunity.title,
        client: opportunity.client,
        occurredAt: opportunity.createdAt,
        type: ActivityType.JOB_CREATED,
      }];
      const activity = opportunity.activities
        .filter((item) => inRange(item.occurredAt) && includesActivity(metric.types, item.type))
        .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];
      return activity ? [{
        jobId: opportunity.id,
        title: opportunity.title,
        client: opportunity.client,
        occurredAt: activity.occurredAt,
        type: activity.type,
      }] : [];
    }).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()),
  ])) as Record<DashboardMetricKey, Array<{
    jobId: string;
    title: string;
    client: string | null;
    occurredAt: Date;
    type: ActivityType;
  }>>;

  return {
    start,
    counts: Object.fromEntries(
      dashboardMetrics.map((metric) => [metric.key, metricSets[metric.key].size]),
    ) as Record<DashboardMetricKey, number>,
    conversions: [
      conversion("Outreach → Reply", "outreach", "replies"),
      conversion("Outreach → Call", "outreach", "calls"),
      conversion("Outreach → Submission", "outreach", "submitted"),
      conversion("Outreach → Interview", "outreach", "interviews"),
      conversion("Interview → Offer", "interviews", "offers"),
    ],
    pipeline: pipelineDefinitions.map((column) => ({
      ...column,
      jobs: opportunities.filter((opportunity) =>
        (inRange(opportunity.createdAt) || opportunity.activities.some((activity) => inRange(activity.occurredAt))) &&
        opportunity.applicationTrack &&
        (column.stages as readonly ApplicationStage[]).includes(opportunity.applicationTrack.currentStage),
      ),
    })),
    details,
    vendorPerformance: performance(opportunities, metricSets, "vendor"),
    recruiterPerformance: performance(opportunities, metricSets, "recruiter"),
  };
}
