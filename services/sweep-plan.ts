import { createHash } from "node:crypto";
import type { FeedPost, NoiseReason } from "@/lib/linkedin-feed";
import { applicationDecision, type PolicyDecision } from "@/services/application-policy";
import { jobFingerprint } from "@/services/job-case";
import type { TriagedPost } from "@/services/post-triage";

/**
 * One post by one person. jobFingerprint drops addresses and links, so two recruiters at one vendor
 * posting the same JD would collide on text alone; the author keeps them apart, since the user wants
 * both. The same person reposting it tomorrow is the same post.
 */
export function postFingerprint(post: FeedPost) {
  const author = (post.profileUrl ?? post.author).normalize("NFKC").toLowerCase().trim();
  return createHash("sha256").update(`${author}\n${jobFingerprint(post.body)}`).digest("hex");
}

export type SweepVerdict =
  | { outcome: "NOISE" | "NOT_RELEVANT" | "SKIPPED" | "NO_EMAIL"; reason: string; decision: PolicyDecision | null }
  | { outcome: "QUEUED"; reason: string; decision: PolicyDecision };

const noiseReasons: Record<NoiseReason, string> = {
  HOTLIST: "Hotlist or bench sales: consultants on offer, not a job.",
  NOT_HIRING: "Marked as not a hiring post.",
};

export function noiseVerdict(reason: NoiseReason): SweepVerdict {
  return { outcome: "NOISE", reason: noiseReasons[reason], decision: null };
}

/** What happens to one screened post; only QUEUED goes on to an intake and the autopilot. */
export function sweepVerdict(triaged: TriagedPost): SweepVerdict {
  if (triaged.kind === "CANDIDATE_OFFER") return { outcome: "NOISE", reason: triaged.reason ?? "Consultants on offer, not a job.", decision: null };
  if (triaged.kind === "OTHER") return { outcome: "NOISE", reason: triaged.reason ?? "Not a job post.", decision: null };
  if (!triaged.relevant) return { outcome: "NOT_RELEVANT", reason: triaged.reason ?? "Outside your role families.", decision: null };
  const decision = applicationDecision(triaged.facts);
  if (decision.verdict === "SKIP") return { outcome: "SKIPPED", reason: decision.reason, decision };
  if (!triaged.recruiterEmail) return { outcome: "NO_EMAIL", reason: "No email in the post: message the author on LinkedIn if it is worth it.", decision };
  return { outcome: "QUEUED", reason: decision.reason, decision };
}

/** Where a queued post stands now, read from its intake, job and draft. */
export type SweepItemState = "WORKING" | "SENT" | "SCHEDULED" | "IN_OUTLOOK" | "NEEDS_YOU" | "SKIPPED";

export function sweepItemState(intake: {
  status: "PENDING" | "CONFIRMED" | "SKIPPED";
  hasPreview: boolean;
  stopReason: string | null;
  draft: { autoSendState: string | null; autoSentAt: Date | null; outlookState: string; autoSendError: string | null; outlookError: string | null } | null;
} | null, taskFailed: boolean): { state: SweepItemState; detail: string | null } {
  if (!intake) return { state: "NEEDS_YOU", detail: "The job was discarded." };
  if (intake.status === "SKIPPED") return { state: "SKIPPED", detail: intake.stopReason };
  if (intake.status === "PENDING") {
    if (intake.stopReason) return { state: "NEEDS_YOU", detail: intake.stopReason };
    if (taskFailed) return { state: "NEEDS_YOU", detail: "Preparing this job failed. Open it to try again." };
    return intake.hasPreview ? { state: "NEEDS_YOU", detail: "Ready for your review." } : { state: "WORKING", detail: null };
  }
  const draft = intake.draft;
  if (!draft) return { state: "NEEDS_YOU", detail: "Confirmed, but no email was written." };
  if (draft.autoSentAt || draft.autoSendState === "SENT") return { state: "SENT", detail: null };
  if (draft.autoSendState === "SCHEDULED" || draft.autoSendState === "SENDING") return { state: "SCHEDULED", detail: null };
  if (draft.autoSendState === "CANCELLED" || draft.autoSendState === "FAILED") return { state: "NEEDS_YOU", detail: draft.autoSendError };
  if (draft.outlookState === "CREATED" || draft.outlookState === "SENT") return { state: "IN_OUTLOOK", detail: null };
  if (draft.outlookState === "NOT_CREATED" || draft.outlookState === "CREATING") return { state: "WORKING", detail: null };
  return { state: "NEEDS_YOU", detail: draft.outlookError ?? "The Outlook draft was not created." };
}
