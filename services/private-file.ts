import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";

export async function resolvePrivateFile(filePath: string) {
  if (!filePath || filePath.length > 4096 || !isAbsolute(filePath)) {
    return { usable: false, canonicalPath: null, size: null, issue: "Use an absolute private file path." };
  }

  try {
    const canonicalPath = await realpath(filePath);
    const workspacePath = await realpath(process.cwd());
    const workspaceRelativePath = relative(workspacePath, canonicalPath);
    const outsideWorkspace = workspaceRelativePath === ".." || workspaceRelativePath.startsWith(`..${sep}`) || isAbsolute(workspaceRelativePath);
    if (!outsideWorkspace) {
      return { usable: false, canonicalPath: null, size: null, issue: "Private files must stay outside the application repository." };
    }
    const details = await stat(canonicalPath);
    if (!details.isFile()) return { usable: false, canonicalPath: null, size: null, issue: "The private path is not a file." };
    return { usable: true, canonicalPath, size: details.size, issue: null };
  } catch {
    return { usable: false, canonicalPath: null, size: null, issue: "The private file is missing or unreadable." };
  }
}
