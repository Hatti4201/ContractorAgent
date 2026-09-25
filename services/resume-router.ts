import { mkdir, open, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { resolvePrivateFile } from "@/services/private-file";

export const RESUME_CONFIDENCE_THRESHOLD = 0.7;
export const MAX_RESUME_SIZE = 25 * 1024 * 1024;

export type ResumeRecord = {
  id: string;
  name: string;
  roleFamily: string;
  filePath: string;
  version: string;
  active: boolean;
};

export type CheckedResume = ResumeRecord & {
  usable: boolean;
  issue: string | null;
};

const signatures: Record<string, (header: Buffer) => boolean> = {
  ".pdf": (header) => header.subarray(0, 5).toString() === "%PDF-",
  ".docx": (header) => header[0] === 0x50 && header[1] === 0x4b,
  ".doc": (header) => header.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
};

function resumeSignature(fileName: string) {
  return signatures[extname(fileName).toLowerCase()];
}

function resumeStoragePath() {
  return process.env.RESUME_STORAGE_PATH?.trim() || join(homedir(), ".contractor-agent", "resumes");
}

export async function saveUploadedResume(file: File) {
  if (!file.size || file.size > MAX_RESUME_SIZE) return null;
  const extension = extname(file.name).toLowerCase();
  const signatureMatches = resumeSignature(file.name);
  if (!signatureMatches) return null;

  const bytes = Buffer.from(await file.arrayBuffer());
  if (!signatureMatches(bytes.subarray(0, 8))) return null;

  const directory = resumeStoragePath();
  const savedPath = join(directory, `${randomUUID()}${extension}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(savedPath, bytes, { mode: 0o600 });
  const checked = await checkResumeFile(savedPath);
  if (!checked.usable || !checked.canonicalPath) {
    await unlink(savedPath).catch(() => undefined);
    return null;
  }
  return checked;
}

export async function checkResumeFile(filePath: string) {
  const resolved = await resolvePrivateFile(filePath);
  if (!resolved.usable || !resolved.canonicalPath) return { usable: false, canonicalPath: null, issue: resolved.issue };
  try {
    const canonicalPath = resolved.canonicalPath;
    const signatureMatches = resumeSignature(canonicalPath);
    if (!signatureMatches) return { usable: false, canonicalPath: null, issue: "Only PDF, DOCX, and DOC resumes are supported.", size: 0 };

    const handle = await open(canonicalPath, "r");
    let size = 0;
    try {
      const header = Buffer.alloc(8);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      if (!bytesRead || !signatureMatches(header)) {
        return { usable: false, canonicalPath: null, issue: "The file contents do not match its extension.", size: 0 };
      }
      size = (await handle.stat()).size;
    } finally {
      await handle.close();
    }
    return { usable: true, canonicalPath, issue: null, size };
  } catch {
    return { usable: false, canonicalPath: null, issue: "The resume file is missing or unreadable.", size: 0 };
  }
}

export async function buildResumeRoute(
  roleFamily: string | null,
  confidence: number,
  resumes: ResumeRecord[],
  // ponytail: several resumes in one family are near-identical versions, so the autopilot takes the
  // first by name instead of waiting. Ranking them by fit would need the resumes' text, which is not read.
  options: { allowSeveral?: boolean; minConfidence?: number } = {},
) {
  const minConfidence = options.minConfidence ?? RESUME_CONFIDENCE_THRESHOLD;
  const checked: CheckedResume[] = await Promise.all(resumes.map(async (resume) => {
    const result = resume.active ? await checkResumeFile(resume.filePath) : { usable: false, issue: "Resume is inactive." };
    return { ...resume, usable: result.usable, issue: result.issue };
  }));
  const usable = checked
    .filter((resume) => resume.active && resume.usable)
    .sort((left, right) => Number(right.roleFamily === roleFamily) - Number(left.roleFamily === roleFamily) || left.name.localeCompare(right.name));
  const matching = usable.filter((resume) => resume.roleFamily === roleFamily);
  const recommended = roleFamily && confidence >= minConfidence && (options.allowSeveral ? matching.length >= 1 : matching.length === 1) ? matching[0] : null;

  let issue: string | null = null;
  if (!roleFamily) issue = "Confirm a role family before selecting a resume.";
  else if (confidence < minConfidence) issue = `Role confidence is below ${Math.round(minConfidence * 100)}%; choose a resume manually.`;
  else if (!recommended) issue = matching.length ? "More than one usable resume matches this role family." : "No usable active resume matches this role family.";

  return { recommended, candidates: usable, checked, needsReview: !recommended, issue };
}
