// The employer copy address is private contact detail, so it lives in private configuration and is
// never chosen by the model: the application decides the recipient, exactly as it does the attachment.
import { getPrisma } from "@/lib/prisma";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function employerCcSetting(env: Partial<Record<string, string>> = process.env) {
  const value = (env.EMPLOYER_CC_ADDRESS ?? "").trim();
  if (!value) return { address: null, issue: null } as const;
  if (!emailPattern.test(value) || value.length > 320) {
    return { address: null, issue: "EMPLOYER_CC_ADDRESS is not a valid email address." } as const;
  }
  return { address: value, issue: null } as const;
}

export async function currentEmployerCcSetting() {
  const control = await getPrisma().autopilotControl.findUnique({ where: { id: "primary" }, select: { employerCcAddress: true } });
  return employerCcSetting({ EMPLOYER_CC_ADDRESS: control?.employerCcAddress ?? process.env.EMPLOYER_CC_ADDRESS });
}

export async function saveEmployerCcAddress(value: string) {
  const setting = employerCcSetting({ EMPLOYER_CC_ADDRESS: value });
  if (setting.issue) return setting;
  await getPrisma().autopilotControl.upsert({
    where: { id: "primary" },
    create: { id: "primary", employerCcAddress: setting.address },
    update: { employerCcAddress: setting.address },
  });
  return setting;
}
