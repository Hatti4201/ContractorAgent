import type { DuplicateMatch, JobCase } from "@/services/job-case";
import type { MatchReport } from "@/services/match-score";
import type { OutreachValidation } from "@/services/outreach-agent";

/**
 * The fit a job needs before the autopilot writes to the recruiter. The first email only has to get
 * the resume read, so the default is half. MATCH_THRESHOLD takes 0.6 or 60; anything unreadable is 0.5.
 */
export function matchThreshold(value = process.env.MATCH_THRESHOLD) {
  const number = Number(value?.trim());
  if (!value?.trim() || !Number.isFinite(number) || number < 0 || number > 100) return 0.5;
  return number > 1 ? number / 100 : number;
}

/**
 * The analyzer's certainty about its own extraction. The review path asks for 70%; the autopilot lets
 * the match score and the validator judge the job instead, and only refuses an extraction this unsure.
 */
export const AUTOPILOT_MIN_CONFIDENCE = 0.5;

/**
 * off (default) = every source waits for the user; draft = mail the scan imported goes all the way to
 * a verified Outlook draft with no click, and only what fails a hard gate waits. The user still sends.
 */
export type AutopilotMode = "off" | "draft";

export function autopilotMode(value = process.env.AUTOPILOT): AutopilotMode {
  return value?.trim().toLowerCase() === "draft" ? "draft" : "off";
}

/** Only mail read from the mailbox rides the autopilot; pasted text is someone at the keyboard already. */
export function autopilotApplies(intake: { sourceMessageId: string | null }, mode = autopilotMode()) {
  return mode === "draft" && Boolean(intake.sourceMessageId);
}

/**
 * The first email only has to get the resume in front of the recruiter, so a loose fit is fine. What
 * the email says about the candidate is not: a BLOCK is a wrong recipient, attachment or fabricated
 * fact, and that still waits for the user. A NEEDS_REVIEW left after one rewrite is let through.
 */
export function autopilotAccepts(validation: OutreachValidation | null) {
  return Boolean(validation) && !validation!.issues.some((issue) => issue.severity === "BLOCK");
}

/**
 * The same JD text again, or a similar title from the recruiter who already has this role, would put
 * a second email in front of someone who has the first. Another vendor on the same role is a normal
 * channel and goes ahead.
 */
export function autopilotDuplicateHold(jobCase: JobCase, matches: DuplicateMatch[]) {
  const exact = matches.find((match) => match.exact);
  if (exact) return `The same JD is already tracked as "${exact.title}".`;
  const recruiter = jobCase.recruiterName?.trim().toLowerCase();
  const sameRecruiter = recruiter
    ? matches.find((match) => match.recruiter?.trim().toLowerCase() === recruiter && match.reasons.includes("Similar job title"))
    : undefined;
  return sameRecruiter ? `${jobCase.recruiterName} already has a similar job tracked: "${sameRecruiter.title}".` : null;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

/**
 * An eligibility conflict the context itself states is the one thing no loose fit makes up for; below
 * that, the score decides. A JD with no skills to score goes ahead, since there is nothing to fall short of.
 */
export function autopilotMatchHold(report: MatchReport | null, threshold = matchThreshold()) {
  if (!report) return "The match score could not be computed.";
  const conflict = report.requirements.find((item) => item.kind === "eligibility" && item.verdict === "CONFLICT");
  if (conflict) return `Eligibility conflict: ${conflict.requirement}${conflict.evidence ? ` (your context: "${conflict.evidence}")` : ""}.`;
  if (report.score === null || report.score >= threshold) return null;
  const missing = report.requirements.filter((item) => item.kind === "skill" && item.verdict === "MISSING").map((item) => item.requirement);
  return `Match ${percent(report.score)} is below ${percent(threshold)}${missing.length ? `; missing ${missing.slice(0, 5).join(", ")}` : ""}.`;
}
