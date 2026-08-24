// The employer copy address is private contact detail, so it lives only in the local environment and
// is never chosen by the model: the application decides the recipient, exactly as it does the attachment.
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function employerCcSetting(env: Partial<Record<string, string>> = process.env) {
  const value = (env.EMPLOYER_CC_ADDRESS ?? "").trim();
  if (!value) return { address: null, issue: null } as const;
  if (!emailPattern.test(value) || value.length > 320) {
    return { address: null, issue: "EMPLOYER_CC_ADDRESS is not a valid email address." } as const;
  }
  return { address: value, issue: null } as const;
}
