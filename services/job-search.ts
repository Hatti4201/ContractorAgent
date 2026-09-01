import type { Prisma } from "@/app/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";

const MAX_RESULTS = 50;
const SNIPPET_WINDOW = 60;
const MAX_SNIPPETS = 2;

export type Snippet = { label: string; before: string; match: string; after: string };

/** Phone numbers are stored as typed, so both sides are reduced to digits before comparing. */
export function phoneDigits(value: string | null | undefined) {
  return (value ?? "").replace(/\D+/g, "");
}

/** A caller id or a remembered last four: digits with only phone punctuation around them. */
export function isPhoneQuery(term: string) {
  return /^[\d\s()+.\-]+$/.test(term) && phoneDigits(term).length >= 4;
}

/** One window of text around the first match, split so the caller can mark the middle part. */
export function matchSnippet(label: string, text: string | null | undefined, term: string): Snippet | null {
  if (!text || !term) return null;
  const index = text.toLowerCase().indexOf(term.toLowerCase());
  if (index < 0) return null;
  const start = Math.max(0, index - SNIPPET_WINDOW);
  const end = Math.min(text.length, index + term.length + SNIPPET_WINDOW);
  return {
    label,
    before: `${start > 0 ? "…" : ""}${text.slice(start, index)}`,
    match: text.slice(index, index + term.length),
    after: `${text.slice(index + term.length, end)}${end < text.length ? "…" : ""}`,
  };
}

/** Everything a row shows inline is highlighted in place; these are the fields it cannot show. */
export function hiddenMatches(job: SearchedJob, term: string): Snippet[] {
  const candidates: Array<[string, string | null | undefined]> = [
    ["JD", job.rawJd],
    ["Recruiter notes", job.recruiter?.notes],
    ["Activity", job.activities[0]?.description],
    ["Email subject", job.outreachDraft?.subject],
    ["Email", job.outreachDraft?.body],
    ["Sent subject", job.outreachDraft?.sentSubject],
    ["Sent email", job.outreachDraft?.sentBody],
  ];
  return candidates
    .flatMap(([label, text]) => {
      const snippet = matchSnippet(label, text, term);
      return snippet ? [snippet] : [];
    })
    .slice(0, MAX_SNIPPETS);
}

/** What a row shows. Nothing here is a long text column, so listing every job stays cheap. */
const listSelection = {
  id: true,
  title: true,
  client: true,
  roleFamily: true,
  recruiterId: true,
  applicationTrack: { select: { currentStage: true, nextFollowUpAt: true } },
  recruiter: { select: { name: true, phone: true } },
  vendor: { select: { name: true } },
  selectedResume: { select: { name: true, version: true } },
} satisfies Prisma.OpportunitySelect;

/** The long columns are read only while searching them, and only for the rows that matched. */
const searchSelection = {
  ...listSelection,
  rawJd: true,
  recruiter: { select: { name: true, phone: true, notes: true } },
  outreachDraft: { select: { subject: true, body: true, sentSubject: true, sentBody: true } },
} satisfies Prisma.OpportunitySelect;

export type ListedJob = Prisma.OpportunityGetPayload<{ select: typeof listSelection }>;
export type SearchedJob = Prisma.OpportunityGetPayload<{
  select: typeof searchSelection & { activities: { select: { description: true } } };
}>;

export function listJobs(database = getPrisma()) {
  return database.opportunity.findMany({ select: listSelection, orderBy: { updatedAt: "desc" } });
}

export type JobSearch = {
  jobs: SearchedJob[];
  /** Recruiters found by digits alone: their phone matches nothing as a substring. */
  phoneMatched: Set<string>;
  truncated: boolean;
};

export async function searchJobs(term: string, database = getPrisma()): Promise<JobSearch> {
  const contains = { contains: term, mode: "insensitive" as const };
  const phoneMatched = new Set<string>();

  if (isPhoneQuery(term)) {
    const digits = phoneDigits(term);
    // ponytail: one small table read beats a generated column; add one if the directory ever grows.
    for (const recruiter of await database.recruiter.findMany({ select: { id: true, phone: true } })) {
      if (recruiter.phone && phoneDigits(recruiter.phone).includes(digits)) phoneMatched.add(recruiter.id);
    }
  }

  const jobs = await database.opportunity.findMany({
    where: {
      OR: [
        { title: contains },
        { client: contains },
        { location: contains },
        { rawJd: contains },
        { recruiter: { is: { OR: [{ name: contains }, { email: contains }, { phone: contains }, { notes: contains }] } } },
        { vendor: { is: { name: contains } } },
        { selectedResume: { is: { OR: [{ name: contains }, { version: contains }] } } },
        { activities: { some: { description: contains } } },
        {
          outreachDraft: {
            is: {
              OR: [
                { subject: contains },
                { body: contains },
                { sentSubject: contains },
                { sentBody: contains },
                { toAddress: contains },
              ],
            },
          },
        },
        ...(phoneMatched.size ? [{ recruiterId: { in: [...phoneMatched] } }] : []),
      ],
    },
    select: { ...searchSelection, activities: { where: { description: contains }, select: { description: true }, take: 1 } },
    orderBy: { updatedAt: "desc" },
    take: MAX_RESULTS + 1,
  });

  return { jobs: jobs.slice(0, MAX_RESULTS), phoneMatched, truncated: jobs.length > MAX_RESULTS };
}
