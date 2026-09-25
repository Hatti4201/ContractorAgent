import { EmploymentType } from "@/app/generated/prisma/enums";
import type { JobCase } from "@/services/job-case";

/**
 * The user's own rules for which jobs to apply to, applied to every source, mail and LinkedIn alike:
 * - W2 (and full-time or 1099, which are employment too) only in the Bay Area, or fully remote;
 * - C2C anywhere, since the user relocates, but not where the job takes local candidates only;
 * - outside the Bay Area, never a job that requires a face-to-face interview.
 *
 * A model reads the facts out of the post (see post-triage.ts); this file decides. Keeping the
 * decision in code is what lets every skip name its exact reason.
 */

export const engagements = ["C2C", "W2", "CONTRACT_1099", "FULL_TIME"] as const;
export type Engagement = (typeof engagements)[number];

export type PolicyFacts = {
  /** Every arrangement the job offers; empty when it names none. */
  engagements: Engagement[];
  locations: Array<{ city: string | null; state: string | null }>;
  /** Fully remote, not hybrid. */
  remote: boolean;
  /** Takes only candidates already living near the job. "Locals preferred" is not this. */
  localOnly: boolean;
  relocationAccepted: boolean;
  /** An in-person (F2F) interview, or onsite from day one for the interview itself. */
  inPersonInterview: boolean;
};

export type PolicyDecision =
  | { verdict: "APPLY"; reason: string; pitch: "C2C" | "W2" | null }
  | { verdict: "SKIP"; reason: string; pitch: null };

const bayAreaCities = new Set([
  // San Francisco, San Mateo
  "san francisco", "sf", "south san francisco", "daly city", "san bruno", "millbrae", "burlingame", "san mateo", "foster city",
  "belmont", "san carlos", "redwood city", "redwood shores", "menlo park", "east palo alto", "half moon bay", "brisbane",
  // Santa Clara
  "san jose", "sunnyvale", "santa clara", "mountain view", "palo alto", "cupertino", "milpitas", "los gatos", "campbell",
  "saratoga", "los altos", "morgan hill", "gilroy",
  // Alameda, Contra Costa
  "oakland", "berkeley", "emeryville", "alameda", "fremont", "hayward", "san leandro", "union city", "newark", "pleasanton",
  "dublin", "livermore", "castro valley", "albany", "walnut creek", "san ramon", "concord", "richmond", "danville",
  "pleasant hill", "martinez", "orinda", "lafayette", "antioch", "pittsburg", "brentwood",
  // Marin, Napa, Solano, Sonoma
  "san rafael", "novato", "mill valley", "sausalito", "larkspur", "napa", "vallejo", "benicia", "fairfield", "vacaville",
  "santa rosa", "petaluma",
]);
/** Bay Area names that are also well-known cities elsewhere: they count only with CA beside them. */
const ambiguousCities = new Set([
  "dublin", "newark", "albany", "richmond", "concord", "fremont", "hayward", "alameda", "brentwood", "danville", "pittsburg",
  "martinez", "fairfield", "union city", "burlingame", "lafayette", "campbell", "belmont", "san carlos", "santa clara",
]);
const regionNames = /\b(?:bay\s*area|silicon\s*valley|sf\s*bay|peninsula|south\s*bay|east\s*bay)\b/i;

function isCalifornia(state: string | null) {
  return Boolean(state && /^(?:ca|calif\.?|california)$/i.test(state.trim()));
}

export function inBayArea(location: { city: string | null; state: string | null }) {
  const city = location.city?.normalize("NFKC").toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim() ?? "";
  if (regionNames.test(city)) return !location.state || isCalifornia(location.state);
  if (!bayAreaCities.has(city)) return false;
  if (isCalifornia(location.state)) return true;
  return !location.state && !ambiguousCities.has(city);
}

function place(facts: PolicyFacts) {
  const named = facts.locations.map((item) => [item.city, item.state].filter(Boolean).join(", ")).filter(Boolean);
  return named.length ? named.slice(0, 3).join(" / ") : "an unstated location";
}

const label: Record<Engagement, string> = { C2C: "C2C", W2: "W2", CONTRACT_1099: "1099", FULL_TIME: "full-time" };

export function applicationDecision(facts: PolicyFacts): PolicyDecision {
  const offers = new Set(facts.engagements);
  const where = place(facts);
  const onlyW2 = offers.size === 1 && offers.has("W2");
  const onlyC2C = offers.size === 1 && offers.has("C2C");

  if (facts.locations.some(inBayArea)) {
    return { verdict: "APPLY", reason: `Bay Area (${where}).`, pitch: onlyW2 ? "W2" : onlyC2C ? "C2C" : null };
  }
  if (facts.remote && !facts.localOnly) {
    return { verdict: "APPLY", reason: "Fully remote.", pitch: onlyW2 ? "W2" : onlyC2C ? "C2C" : null };
  }
  // Outside the Bay Area only C2C is taken, and a job naming no arrangement is asked as C2C.
  if (offers.size && !offers.has("C2C")) {
    return { verdict: "SKIP", reason: `${[...offers].map((item) => label[item]).join("/")} only, in ${where}: outside the Bay Area you take C2C only.`, pitch: null };
  }
  if (facts.localOnly && !facts.relocationAccepted) {
    return { verdict: "SKIP", reason: `Local candidates only, in ${where}, with no relocation.`, pitch: null };
  }
  if (facts.inPersonInterview) {
    return { verdict: "SKIP", reason: `Face-to-face interview required in ${where}, outside the Bay Area.`, pitch: null };
  }
  return { verdict: "APPLY", reason: `C2C in ${where}${facts.relocationAccepted ? ", relocation accepted" : ""}.`, pitch: "C2C" };
}

/** Reads stored facts back, or null for anything that is not a complete set. */
export function readPolicyFacts(value: unknown): PolicyFacts | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const facts = value as Record<string, unknown>;
  if (!Array.isArray(facts.engagements) || !facts.engagements.every((item) => engagements.includes(item as Engagement))) return null;
  if (!Array.isArray(facts.locations)) return null;
  const locations = facts.locations.flatMap((item) => {
    const entry = item as { city?: unknown; state?: unknown } | null;
    if (!entry || typeof entry !== "object") return [];
    const text = (field: unknown) => (typeof field === "string" && field.trim() ? field.trim().slice(0, 100) : null);
    return [{ city: text(entry.city), state: text(entry.state) }];
  }).slice(0, 20);
  const flags = ["remote", "localOnly", "relocationAccepted", "inPersonInterview"] as const;
  if (flags.some((flag) => typeof facts[flag] !== "boolean")) return null;
  return {
    engagements: [...new Set(facts.engagements as Engagement[])],
    locations,
    remote: facts.remote as boolean,
    localOnly: facts.localOnly as boolean,
    relocationAccepted: facts.relocationAccepted as boolean,
    inPersonInterview: facts.inPersonInterview as boolean,
  };
}

/** What the pipeline keeps on the intake: the facts it was given and the decision they led to. */
export type StoredPolicy = { facts: PolicyFacts; decision: PolicyDecision };

export function readStoredPolicy(value: unknown): StoredPolicy | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const facts = readPolicyFacts((value as { facts?: unknown }).facts);
  return facts ? { facts, decision: applicationDecision(facts) } : null;
}

/**
 * Outside the Bay Area a job offering both is taken as C2C, and the email has to say so; the rules
 * decide that, not whichever arrangement the post happened to list first.
 */
export function pitchedCase(analysis: JobCase, decision: PolicyDecision): JobCase {
  const target = decision.pitch === "C2C" ? EmploymentType.C2C : decision.pitch === "W2" ? EmploymentType.W2 : null;
  if (!target || analysis.employmentType === target) return analysis;
  return {
    ...analysis,
    employmentType: target,
    warnings: [
      ...analysis.warnings.slice(0, 29),
      { field: "employmentType", severity: "INFO", message: `Set to ${decision.pitch} by your application rules: ${decision.reason}`, evidence: null },
    ],
  };
}
