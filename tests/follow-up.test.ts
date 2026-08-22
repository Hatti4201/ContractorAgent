import assert from "node:assert/strict";
import test from "node:test";
import {
  ActivityType,
  ApplicationStage,
  FollowUpEvent,
} from "../app/generated/prisma/enums";
import {
  analyzeFollowUpEmail,
  matchFollowUpOpportunity,
  parseFollowUpAnalysis,
  proposalForFollowUp,
  type FollowUpAnalysis,
  type FollowUpCandidate,
} from "../services/follow-up";

const interview: FollowUpAnalysis = {
  event: FollowUpEvent.INTERVIEW_SCHEDULED,
  waitingOn: "Candidate",
  nextAction: "Review the interview details.",
  nextFollowUpDate: "2026-08-25",
  confidence: 0.94,
  evidence: [{ quote: "interview is scheduled" }],
};

const candidates: FollowUpCandidate[] = [
  { id: "java", title: "Fictional Java Backend Engineer", client: "Example Client", currentStage: ApplicationStage.OUTREACH_SENT, recruiterEmail: "recruiter@example.invalid" },
  { id: "react", title: "Fictional React Engineer", client: "Another Client", currentStage: ApplicationStage.RECRUITER_ENGAGED, recruiterEmail: "recruiter@example.invalid" },
];

test("follow-up matching stays deterministic and ambiguous known senders require human linking", () => {
  assert.deepEqual(matchFollowUpOpportunity("recruiter@example.invalid", "Re: Fictional Java Backend Engineer", candidates), { relevant: true, opportunityId: "java" });
  assert.deepEqual(matchFollowUpOpportunity("recruiter@example.invalid", "Quick update", candidates), { relevant: true, opportunityId: null });
  assert.deepEqual(matchFollowUpOpportunity("alias@example.invalid", "Fictional React Engineer interview", candidates), { relevant: true, opportunityId: "react" });
  assert.deepEqual(matchFollowUpOpportunity("newsletter@example.invalid", "Weekly news", candidates), { relevant: false, opportunityId: null });
});

test("follow-up proposals map explicit events without regressing an advanced stage", () => {
  const proposal = proposalForFollowUp(interview, ApplicationStage.RECRUITER_ENGAGED);
  assert.equal(proposal.proposedActivity, ActivityType.INTERVIEW_SCHEDULED);
  assert.equal(proposal.proposedStage, ApplicationStage.INTERVIEW_SCHEDULED);
  assert.equal(proposal.proposedNextFollowUpAt?.toISOString(), "2026-08-25T12:00:00.000Z");
  assert.equal(proposalForFollowUp(interview, ApplicationStage.OFFER).proposedStage, null);
  assert.equal(proposalForFollowUp({ ...interview, event: FollowUpEvent.NO_ACTION }, ApplicationStage.OUTREACH_SENT).proposedActivity, null);
  assert.throws(() => parseFollowUpAnalysis({ ...interview, confidence: 2 }));
});

test("follow-up AI requests strict non-stored output and rejects invented evidence", async () => {
  const requests: Record<string, unknown>[] = [];
  let output = interview;
  const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify(output) }] }] });
  }) as typeof fetch;
  const input = {
    subject: "Fictional interview update",
    preview: "Your interview is scheduled for a fictional date.",
    receivedAt: "2026-08-22T12:00:00.000Z",
    today: "2026-08-22",
    opportunity: { title: "Fictional Java Backend Engineer", client: "Example Client", currentStage: ApplicationStage.RECRUITER_ENGAGED },
  };

  const result = await analyzeFollowUpEmail(input, { apiKey: "test-key", model: "test-model", fetcher });
  assert.equal(result.event, FollowUpEvent.INTERVIEW_SCHEDULED);
  assert.equal(requests[0]?.store, false);
  assert.equal((requests[0]?.text as { format?: { strict?: boolean } }).format?.strict, true);

  output = { ...interview, evidence: [{ quote: "invented unsupported claim" }] };
  await assert.rejects(() => analyzeFollowUpEmail(input, { apiKey: "test-key", fetcher }), /unsupported evidence/);
});
