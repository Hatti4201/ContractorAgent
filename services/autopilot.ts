import type { DuplicateMatch, JobCase } from "@/services/job-case";
import type { OutreachValidation } from "@/services/outreach-agent";

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
