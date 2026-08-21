import { open, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, sep } from "node:path";
import { RoleFamily } from "@/app/generated/prisma/enums";

export const RESUME_CONFIDENCE_THRESHOLD = 0.7;

export type ResumeRecord = {
  id: string;
  name: string;
  roleFamily: RoleFamily;
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

export async function checkResumeFile(filePath: string) {
  if (!filePath || filePath.length > 4096 || !isAbsolute(filePath)) {
    return { usable: false, canonicalPath: null, issue: "Use an absolute PDF, DOCX, or DOC path." };
  }

  try {
    const canonicalPath = await realpath(filePath);
    const workspacePath = await realpath(process.cwd());
    const workspaceRelativePath = relative(workspacePath, canonicalPath);
    const outsideWorkspace = workspaceRelativePath === ".." || workspaceRelativePath.startsWith(`..${sep}`) || isAbsolute(workspaceRelativePath);
    if (!outsideWorkspace) {
      return { usable: false, canonicalPath: null, issue: "Resume files must stay outside the application repository." };
    }

    const extension = extname(canonicalPath).toLowerCase();
    const signatureMatches = signatures[extension];
    if (!signatureMatches) return { usable: false, canonicalPath: null, issue: "Only PDF, DOCX, and DOC resumes are supported." };
    if (!(await stat(canonicalPath)).isFile()) return { usable: false, canonicalPath: null, issue: "The resume path is not a file." };

    const handle = await open(canonicalPath, "r");
    try {
      const header = Buffer.alloc(8);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      if (!bytesRead || !signatureMatches(header)) {
        return { usable: false, canonicalPath: null, issue: "The file contents do not match its extension." };
      }
    } finally {
      await handle.close();
    }
    return { usable: true, canonicalPath, issue: null };
  } catch {
    return { usable: false, canonicalPath: null, issue: "The resume file is missing or unreadable." };
  }
}

export async function buildResumeRoute(
  roleFamily: RoleFamily | null,
  confidence: number,
  resumes: ResumeRecord[],
) {
  const checked: CheckedResume[] = await Promise.all(resumes.map(async (resume) => {
    const result = resume.active ? await checkResumeFile(resume.filePath) : { usable: false, issue: "Resume is inactive." };
    return { ...resume, usable: result.usable, issue: result.issue };
  }));
  const usable = checked
    .filter((resume) => resume.active && resume.usable)
    .sort((left, right) => Number(right.roleFamily === roleFamily) - Number(left.roleFamily === roleFamily) || left.name.localeCompare(right.name));
  const matching = usable.filter((resume) => resume.roleFamily === roleFamily);
  const recommended = roleFamily && confidence >= RESUME_CONFIDENCE_THRESHOLD && matching.length === 1 ? matching[0] : null;

  let issue: string | null = null;
  if (!roleFamily) issue = "Confirm a role family before selecting a resume.";
  else if (confidence < RESUME_CONFIDENCE_THRESHOLD) issue = "Role confidence is below 70%; choose a resume manually.";
  else if (matching.length !== 1) issue = matching.length ? "More than one usable resume matches this role family." : "No usable active resume matches this role family.";

  return { recommended, candidates: usable, checked, needsReview: !recommended, issue };
}
