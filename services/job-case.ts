import { createHash } from "node:crypto";
import {
  ApplicationStage,
  EmploymentType,
  RoleFamily,
  WorkArrangement,
} from "@/app/generated/prisma/enums";

const warningSeverities = ["INFO", "NEEDS_REVIEW", "CONFLICT"] as const;
type WarningSeverity = (typeof warningSeverities)[number];

export type JobCase = {
  title: string | null;
  client: string | null;
  vendor: string | null;
  recruiterName: string | null;
  recruiterEmail: string | null;
  recruiterPhone: string | null;
  location: string | null;
  workArrangement: WorkArrangement;
  employmentType: EmploymentType;
  rate: string | null;
  yearsRequired: string | null;
  requiredSkills: string[];
  visaRequirement: string | null;
  localRequirement: string | null;
  relocationRequirement: string | null;
  clearanceRequirement: string | null;
  roleFamily: RoleFamily | null;
  confidence: number;
  warnings: Array<{ field: string; severity: WarningSeverity; message: string; evidence: string | null }>;
  evidence: Array<{ field: string; quote: string }>;
};

const nullableString = () => ({ anyOf: [{ type: "string" }, { type: "null" }] });
const nullableEnum = (values: readonly string[]) => ({ anyOf: [{ type: "string", enum: values }, { type: "null" }] });

export const jobCaseJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: nullableString(),
    client: nullableString(),
    vendor: nullableString(),
    recruiterName: nullableString(),
    recruiterEmail: nullableString(),
    recruiterPhone: nullableString(),
    location: nullableString(),
    workArrangement: { type: "string", enum: Object.values(WorkArrangement) },
    employmentType: { type: "string", enum: Object.values(EmploymentType) },
    rate: nullableString(),
    yearsRequired: nullableString(),
    requiredSkills: { type: "array", items: { type: "string" } },
    visaRequirement: nullableString(),
    localRequirement: nullableString(),
    relocationRequirement: nullableString(),
    clearanceRequirement: nullableString(),
    roleFamily: nullableEnum(Object.values(RoleFamily)),
    confidence: { type: "number" },
    warnings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          field: { type: "string" },
          severity: { type: "string", enum: warningSeverities },
          message: { type: "string" },
          evidence: nullableString(),
        },
        required: ["field", "severity", "message", "evidence"],
      },
    },
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          field: { type: "string" },
          quote: { type: "string" },
        },
        required: ["field", "quote"],
      },
    },
  },
  required: [
    "title", "client", "vendor", "recruiterName", "recruiterEmail", "recruiterPhone",
    "location", "workArrangement", "employmentType", "rate", "yearsRequired", "requiredSkills",
    "visaRequirement", "localRequirement", "relocationRequirement", "clearanceRequirement",
    "roleFamily", "confidence", "warnings", "evidence",
  ],
} as const;

function record(value: unknown, name: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], name: string) {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) {
    throw new Error(`${name} does not match the required schema.`);
  }
}

function optionalText(value: unknown, maximum: number, name: string) {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > maximum) throw new Error(`${name} is invalid.`);
  return value.trim() || null;
}

function requiredText(value: unknown, maximum: number, name: string) {
  const cleaned = optionalText(value, maximum, name);
  if (!cleaned) throw new Error(`${name} is required.`);
  return cleaned;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], name: string) {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error(`${name} is invalid.`);
  return value as T;
}

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[], name: string) {
  return value === null ? null : enumValue(value, allowed, name);
}

function textList(value: unknown, maximum: number, itemMaximum: number, name: string) {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${name} is invalid.`);
  return [...new Set(value.map((item, index) => requiredText(item, itemMaximum, `${name}[${index}]`)))];
}

export function parseJobCase(value: unknown): JobCase {
  const input = record(value, "JobCase");
  const keys = jobCaseJsonSchema.required;
  exactKeys(input, keys, "JobCase");
  const warnings = Array.isArray(input.warnings) ? input.warnings : null;
  const evidence = Array.isArray(input.evidence) ? input.evidence : null;
  if (!warnings || warnings.length > 30 || !evidence || evidence.length > 30) throw new Error("JobCase review data is invalid.");

  return {
    title: optionalText(input.title, 200, "title"),
    client: optionalText(input.client, 200, "client"),
    vendor: optionalText(input.vendor, 200, "vendor"),
    recruiterName: optionalText(input.recruiterName, 200, "recruiterName"),
    recruiterEmail: optionalText(input.recruiterEmail, 320, "recruiterEmail"),
    recruiterPhone: optionalText(input.recruiterPhone, 80, "recruiterPhone"),
    location: optionalText(input.location, 200, "location"),
    workArrangement: enumValue(input.workArrangement, Object.values(WorkArrangement), "workArrangement"),
    employmentType: enumValue(input.employmentType, Object.values(EmploymentType), "employmentType"),
    rate: optionalText(input.rate, 200, "rate"),
    yearsRequired: optionalText(input.yearsRequired, 200, "yearsRequired"),
    requiredSkills: textList(input.requiredSkills, 50, 100, "requiredSkills"),
    visaRequirement: optionalText(input.visaRequirement, 500, "visaRequirement"),
    localRequirement: optionalText(input.localRequirement, 500, "localRequirement"),
    relocationRequirement: optionalText(input.relocationRequirement, 500, "relocationRequirement"),
    clearanceRequirement: optionalText(input.clearanceRequirement, 500, "clearanceRequirement"),
    roleFamily: optionalEnum(input.roleFamily, Object.values(RoleFamily), "roleFamily"),
    confidence: typeof input.confidence === "number" && Number.isFinite(input.confidence) && input.confidence >= 0 && input.confidence <= 1
      ? input.confidence
      : (() => { throw new Error("confidence is invalid."); })(),
    warnings: warnings.map((item, index) => {
      const warning = record(item, `warnings[${index}]`);
      exactKeys(warning, ["field", "severity", "message", "evidence"], `warnings[${index}]`);
      return {
        field: requiredText(warning.field, 100, `warnings[${index}].field`),
        severity: enumValue(warning.severity, warningSeverities, `warnings[${index}].severity`),
        message: requiredText(warning.message, 500, `warnings[${index}].message`),
        evidence: optionalText(warning.evidence, 500, `warnings[${index}].evidence`),
      };
    }),
    evidence: evidence.map((item, index) => {
      const source = record(item, `evidence[${index}]`);
      exactKeys(source, ["field", "quote"], `evidence[${index}]`);
      return {
        field: requiredText(source.field, 100, `evidence[${index}].field`),
        quote: requiredText(source.quote, 500, `evidence[${index}].quote`),
      };
    }),
  };
}

export function addRequiredReviewWarnings(value: JobCase): JobCase {
  const warnings = value.warnings.slice(0, 23);
  const requirements = [
    ["visaRequirement", "Visa"],
    ["localRequirement", "Local candidate"],
    ["relocationRequirement", "Relocation"],
    ["clearanceRequirement", "Clearance"],
    ["yearsRequired", "Years required"],
    ["rate", "Rate"],
  ] as const;

  for (const [field, label] of requirements) {
    if (warnings.some((warning) => warning.field === field && warning.severity !== "INFO")) continue;
    warnings.push({
      field,
      severity: "NEEDS_REVIEW",
      message: value[field] ? `${label} is a hard requirement and needs human review.` : `${label} is not stated and remains unknown.`,
      evidence: value.evidence.find((item) => item.field === field)?.quote ?? null,
    });
  }
  if (value.confidence < 0.7 && !warnings.some((warning) => warning.field === "confidence")) {
    warnings.push({ field: "confidence", severity: "NEEDS_REVIEW", message: "Analysis confidence is below 70%.", evidence: null });
  }
  return { ...value, warnings };
}

export function jobFingerprint(rawText: string) {
  const normalized = rawText
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/g, " ")
    .replace(/\+?\d[\d(). -]{7,}\d/g, " ")
    .replace(/[^\p{L}\p{N}+#.]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(normalized).digest("hex");
}

type DuplicateCandidate = {
  id: string;
  title: string;
  client: string | null;
  location: string | null;
  employmentType: EmploymentType;
  rawJd: string | null;
  jobCase: unknown;
  jdFingerprint: string | null;
  createdAt: Date;
  vendor: { name: string } | null;
  applicationTrack: { currentStage: ApplicationStage } | null;
};

export type DuplicateMatch = {
  id: string;
  title: string;
  client: string | null;
  stage: ApplicationStage | null;
  createdAt: Date;
  score: number;
  reasons: string[];
};

function normalized(value: string | null | undefined) {
  return value?.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() ?? "";
}

function titleSimilarity(left: string | null, right: string | null) {
  const first = new Set(normalized(left).split(" ").filter(Boolean));
  const second = new Set(normalized(right).split(" ").filter(Boolean));
  if (!first.size || !second.size) return 0;
  const intersection = [...first].filter((word) => second.has(word)).length;
  return intersection / new Set([...first, ...second]).size;
}

function confirmedCase(candidate: DuplicateCandidate) {
  try {
    return candidate.jobCase ? parseJobCase(candidate.jobCase) : null;
  } catch {
    return null;
  }
}

export function findDuplicateMatches(
  jobCase: JobCase,
  fingerprint: string,
  receivedAt: Date,
  candidates: DuplicateCandidate[],
) {
  return candidates.flatMap((candidate): DuplicateMatch[] => {
    const candidateFingerprint = candidate.jdFingerprint ?? (candidate.rawJd ? jobFingerprint(candidate.rawJd) : null);
    if (candidateFingerprint === fingerprint) return [{
      id: candidate.id,
      title: candidate.title,
      client: candidate.client,
      stage: candidate.applicationTrack?.currentStage ?? null,
      createdAt: candidate.createdAt,
      score: 1,
      reasons: ["Exact JD fingerprint"],
    }];

    const previous = confirmedCase(candidate);
    const reasons: string[] = [];
    let score = titleSimilarity(jobCase.title, candidate.title) * 0.35;
    if (score >= 0.18) reasons.push("Similar job title");
    const equal = (left: string | null | undefined, right: string | null | undefined) => Boolean(normalized(left) && normalized(left) === normalized(right));
    if (equal(jobCase.client, candidate.client)) { score += 0.15; reasons.push("Same client"); }
    if (equal(jobCase.location, candidate.location)) { score += 0.1; reasons.push("Same location"); }
    if (equal(jobCase.vendor, candidate.vendor?.name)) { score += 0.1; reasons.push("Same vendor"); }
    if (equal(jobCase.rate, previous?.rate)) { score += 0.1; reasons.push("Same rate"); }
    if (jobCase.employmentType !== EmploymentType.UNKNOWN && jobCase.employmentType === candidate.employmentType) {
      score += 0.1;
      reasons.push("Same employment type");
    }
    if (Math.abs(receivedAt.getTime() - candidate.createdAt.getTime()) <= 180 * 86_400_000) {
      score += 0.1;
      reasons.push("Created within 180 days");
    }
    if (score < 0.3) return [];
    return [{
      id: candidate.id,
      title: candidate.title,
      client: candidate.client,
      stage: candidate.applicationTrack?.currentStage ?? null,
      createdAt: candidate.createdAt,
      score: Math.min(score, 0.99),
      reasons,
    }];
  }).sort((left, right) => right.score - left.score || right.createdAt.getTime() - left.createdAt.getTime()).slice(0, 5);
}

function formText(formData: FormData, name: keyof JobCase, maximum: number, required = false) {
  const value = formData.get(name);
  const cleaned = typeof value === "string" ? value.trim() : "";
  if (required && !cleaned) throw new Error(`${name} is required.`);
  if (cleaned.length > maximum) throw new Error(`${name} is too long.`);
  return cleaned || null;
}

export function readReviewedJobCase(formData: FormData, original: JobCase): JobCase & { title: string } {
  const recruiterEmail = formText(formData, "recruiterEmail", 320);
  if (recruiterEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recruiterEmail)) throw new Error("Recruiter email is invalid.");
  const requiredSkills = (formText(formData, "requiredSkills", 5000) ?? "")
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 50);
  const selected = <T extends string>(name: keyof JobCase, allowed: readonly T[], fallback: T) => {
    const value = formData.get(name);
    return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
  };
  const roleValue = formData.get("roleFamily");

  return {
    ...original,
    title: formText(formData, "title", 200, true)!,
    client: formText(formData, "client", 200),
    vendor: formText(formData, "vendor", 200),
    recruiterName: formText(formData, "recruiterName", 200),
    recruiterEmail,
    recruiterPhone: formText(formData, "recruiterPhone", 80),
    location: formText(formData, "location", 200),
    workArrangement: selected("workArrangement", Object.values(WorkArrangement), WorkArrangement.UNKNOWN),
    employmentType: selected("employmentType", Object.values(EmploymentType), EmploymentType.UNKNOWN),
    rate: formText(formData, "rate", 200),
    yearsRequired: formText(formData, "yearsRequired", 200),
    requiredSkills,
    visaRequirement: formText(formData, "visaRequirement", 500),
    localRequirement: formText(formData, "localRequirement", 500),
    relocationRequirement: formText(formData, "relocationRequirement", 500),
    clearanceRequirement: formText(formData, "clearanceRequirement", 500),
    roleFamily: typeof roleValue === "string" && Object.values(RoleFamily).includes(roleValue as RoleFamily) ? roleValue as RoleFamily : null,
  };
}
