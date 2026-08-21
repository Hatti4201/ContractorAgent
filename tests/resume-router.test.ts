import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RoleFamily } from "../app/generated/prisma/enums";
import { buildResumeRoute, checkResumeFile } from "../services/resume-router";

test("resume routing uses one real enabled registry file and requires review below 70%", async () => {
  const directory = await mkdtemp(join(tmpdir(), "contractor-agent-resume-router-"));
  try {
    const javaPath = join(directory, "sample-java.pdf");
    const reactPath = join(directory, "sample-react.docx");
    const wrongPath = join(directory, "not-a-resume.pdf");
    await writeFile(javaPath, Buffer.from("%PDF-1.7\nfictional test file"));
    await writeFile(reactPath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]));
    await writeFile(wrongPath, "plain text");

    const resumes = [
      { id: "java", name: "Sample Java", roleFamily: RoleFamily.JAVA_BACKEND, filePath: javaPath, version: "v1", active: true },
      { id: "react", name: "Sample React", roleFamily: RoleFamily.REACT, filePath: reactPath, version: "v1", active: true },
      { id: "inactive", name: "Old Java", roleFamily: RoleFamily.JAVA_BACKEND, filePath: javaPath, version: "v0", active: false },
      { id: "missing", name: "Missing AI", roleFamily: RoleFamily.JAVA_AI, filePath: join(directory, "missing.pdf"), version: "v1", active: true },
    ];

    const confident = await buildResumeRoute(RoleFamily.JAVA_BACKEND, 0.9, resumes);
    assert.equal(confident.recommended?.id, "java");
    assert.deepEqual(confident.candidates.map((resume) => resume.id), ["java", "react"]);

    const uncertain = await buildResumeRoute(RoleFamily.JAVA_BACKEND, 0.69, resumes);
    assert.equal(uncertain.recommended, null);
    assert.equal(uncertain.needsReview, true);
    assert.match(uncertain.issue ?? "", /below 70%/);
    assert.equal((await checkResumeFile(wrongPath)).usable, false);
    assert.equal((await checkResumeFile(join(directory, "missing.pdf"))).usable, false);
    assert.match((await checkResumeFile(join(process.cwd(), "README.md"))).issue ?? "", /outside the application repository/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
