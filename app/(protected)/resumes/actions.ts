"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { activeRoleFamilies, readRoleFamilyCode } from "@/services/role-family";
import { checkResumeFile } from "@/services/resume-router";

// Only an internal job path is honoured, so a submitted value can never redirect off the application.
function returnPath(formData: FormData) {
  const value = formData.get("from");
  return typeof value === "string" && /^\/jobs\/[a-z0-9]{20,40}$/.test(value) ? value : null;
}

function text(formData: FormData, name: string, maximum: number) {
  const value = formData.get(name);
  return typeof value === "string" && value.trim() && value.trim().length <= maximum ? value.trim() : null;
}

export async function registerResume(formData: FormData) {
  await requireAuth();
  const back = returnPath(formData);
  const name = text(formData, "name", 200);
  const version = text(formData, "version", 100);
  const submittedPath = text(formData, "filePath", 4096);
  const submittedRole = formData.get("roleFamily");
  const query = back ? `&from=${encodeURIComponent(back)}` : "";
  const allowed = (await activeRoleFamilies()).map((family: { code: string }) => family.code);
  if (!name || !version || !submittedPath || typeof submittedRole !== "string" || !allowed.includes(submittedRole)) {
    redirect(`/resumes?error=fields${query}`);
  }

  const file = await checkResumeFile(submittedPath);
  if (!file.usable || !file.canonicalPath) redirect(`/resumes?error=file${query}`);
  const database = getPrisma();
  if (await database.resume.findUnique({ where: { name_version: { name, version } } })) redirect(`/resumes?error=duplicate${query}`);

  const active = formData.get("active") === "on";
  await database.$transaction(async (transaction) => {
    if (active) await transaction.resume.updateMany({ where: { roleFamily: submittedRole, active: true }, data: { active: false } });
    await transaction.resume.create({
      data: { name, version, filePath: file.canonicalPath, roleFamily: submittedRole, active },
    });
  });

  revalidatePath("/resumes");
  revalidatePath("/jobs");
  if (back) {
    revalidatePath(back);
    redirect(`${back}#resume-router`);
  }
  redirect("/resumes?saved=1");
}

/**
 * Adding a family is ordinary work now, not an amendment. The code is the foreign key every job and
 * resume stores, so it is fixed at creation; the label and description stay editable.
 */
export async function createRoleFamily(formData: FormData) {
  await requireAuth();
  const label = text(formData, "label", 100);
  const description = text(formData, "description", 500);
  let code: string;
  try {
    code = readRoleFamilyCode(formData.get("code"));
  } catch {
    redirect("/resumes?error=family-code");
  }
  if (!label || !description) redirect("/resumes?error=family-fields");

  const database = getPrisma();
  if (await database.roleFamily.findUnique({ where: { code } })) redirect("/resumes?error=family-duplicate");
  const last = await database.roleFamily.findFirst({ orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  await database.roleFamily.create({
    data: { code, label, description, sortOrder: (last?.sortOrder ?? 0) + 10 },
  });

  revalidatePath("/resumes");
  revalidatePath("/dashboard");
  redirect("/resumes?saved=1");
}

/** Deactivating hides a family from every picker; the records already filed under it keep it. */
export async function setRoleFamilyActive(code: string, active: boolean) {
  await requireAuth();
  await getPrisma().roleFamily.update({ where: { code }, data: { active } });
  revalidatePath("/resumes");
  revalidatePath("/dashboard");
  redirect("/resumes?saved=1");
}

export async function setResumeActive(id: string, active: boolean) {
  await requireAuth();
  const database = getPrisma();
  const resume = await database.resume.findUnique({ where: { id } });
  if (!resume) redirect("/resumes?error=missing");
  if (active && !(await checkResumeFile(resume.filePath)).usable) redirect("/resumes?error=file");

  await database.$transaction(async (transaction) => {
    if (active) await transaction.resume.updateMany({ where: { roleFamily: resume.roleFamily, active: true }, data: { active: false } });
    await transaction.resume.update({ where: { id }, data: { active } });
  });

  revalidatePath("/resumes");
  revalidatePath("/jobs");
  redirect("/resumes?saved=1");
}

export async function deleteResume(id: string) {
  await requireAuth();
  const database = getPrisma();
  const resume = await database.resume.findUnique({ where: { id }, select: { id: true } });
  if (!resume) redirect("/resumes?error=missing");
  if (await database.outreachDraft.count({ where: { attachmentResumeId: id } })) redirect("/resumes?error=in-use");

  await database.resume.delete({ where: { id } });
  revalidatePath("/resumes");
  revalidatePath("/jobs");
  redirect("/resumes?saved=1");
}
