"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { RoleFamily } from "@/app/generated/prisma/enums";
import { requireAuth } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
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
  if (!name || !version || !submittedPath || typeof submittedRole !== "string" || !Object.values(RoleFamily).includes(submittedRole as RoleFamily)) {
    redirect(`/resumes?error=fields${query}`);
  }

  const file = await checkResumeFile(submittedPath);
  if (!file.usable || !file.canonicalPath) redirect(`/resumes?error=file${query}`);
  const database = getPrisma();
  if (await database.resume.findUnique({ where: { name_version: { name, version } } })) redirect(`/resumes?error=duplicate${query}`);

  const active = formData.get("active") === "on";
  await database.$transaction(async (transaction) => {
    if (active) await transaction.resume.updateMany({ where: { roleFamily: submittedRole as RoleFamily, active: true }, data: { active: false } });
    await transaction.resume.create({
      data: { name, version, filePath: file.canonicalPath, roleFamily: submittedRole as RoleFamily, active },
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
