import Link from "next/link";
import { deleteResume, registerResume, setResumeActive } from "@/app/(protected)/resumes/actions";
import { DeleteResumeForm } from "@/components/delete-job-form";
import { roleFamilies, formatEnum } from "@/lib/job-values";
import { getPrisma } from "@/lib/prisma";
import { checkResumeFile } from "@/services/resume-router";

const inputClass = "mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";
const errors: Record<string, string> = {
  fields: "Complete every field with a valid value.",
  file: "The file must be a readable PDF, DOCX, or DOC outside this repository, with contents matching its extension.",
  duplicate: "That resume name and version already exist.",
  missing: "That registry entry no longer exists.",
  "in-use": "This resume is attached to an outreach draft and cannot be deleted until that draft is removed.",
};

export default async function ResumesPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; from?: string }> }) {
  const { error, saved, from } = await searchParams;
  const back = typeof from === "string" && /^\/jobs\/[a-z0-9]{20,40}$/.test(from) ? from : null;
  const resumes = await getPrisma().resume.findMany({ orderBy: [{ roleFamily: "asc" }, { active: "desc" }, { updatedAt: "desc" }] });
  const fileChecks = new Map(await Promise.all(resumes.map(async (resume) => [resume.id, await checkResumeFile(resume.filePath)] as const)));

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Phase 5</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Resume registry</h1>
      <p className="mt-3 max-w-3xl text-slate-600">Register only real local files. Paths stay in the private database; resume files remain outside this public-code repository.</p>
      {back && <p className="mt-4 text-sm text-slate-700">Registering here returns you to the job you came from. <Link className="font-medium text-emerald-700 underline" href={`${back}#resume-router`}>Go back without adding</Link>.</p>}

      {saved && <p className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-900" role="status">Registry updated.</p>}
      {error && <p className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800" role="alert">{errors[error] ?? "Registry update failed."}</p>}

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-950">Add resume version</h2>
        <form action={registerResume} className="mt-5 grid gap-5 md:grid-cols-2">
          {back && <input name="from" type="hidden" value={back} />}
          <label className="text-sm font-medium text-slate-800">Name <span aria-hidden="true" className="text-red-700">*</span><input className={inputClass} maxLength={200} name="name" required /></label>
          <label className="text-sm font-medium text-slate-800">Version <span aria-hidden="true" className="text-red-700">*</span><input className={inputClass} maxLength={100} name="version" required /></label>
          <label className="text-sm font-medium text-slate-800">Role family <span aria-hidden="true" className="text-red-700">*</span><select className={inputClass} name="roleFamily" required>{roleFamilies.map((role) => <option key={role} value={role}>{formatEnum(role)}</option>)}</select></label>
          <label className="text-sm font-medium text-slate-800">Absolute local path <span aria-hidden="true" className="text-red-700">*</span><input className={inputClass} maxLength={4096} name="filePath" placeholder="/private/example.invalid/sample-resume.pdf" required /></label>
          <label className="flex items-center gap-3 text-sm font-medium text-slate-800 md:col-span-2"><input className="h-4 w-4" name="active" type="checkbox" />Enable now (disables the current active version for this role)</label>
          <button className="w-fit rounded-lg bg-slate-950 px-5 py-3 font-medium text-white hover:bg-slate-800" type="submit">Register resume</button>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold text-slate-950">Six-family registry</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {roleFamilies.map((role) => {
            const entries = resumes.filter((resume) => resume.roleFamily === role);
            return (
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" key={role}>
                <div className="flex items-center justify-between gap-3"><h3 className="font-semibold text-slate-950">{formatEnum(role)}</h3><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${entries.some((resume) => resume.active && fileChecks.get(resume.id)?.usable) ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>{entries.some((resume) => resume.active && fileChecks.get(resume.id)?.usable) ? "Ready" : "Needs file"}</span></div>
                {entries.length ? (
                  <ul className="mt-4 space-y-3">
                    {entries.map((resume) => {
                      const file = fileChecks.get(resume.id);
                      return (
                        <li className="rounded-xl border border-slate-200 p-4 text-sm" key={resume.id}>
                          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold text-slate-950">{resume.name} · {resume.version}</p><p className="mt-1 break-all text-xs text-slate-500">{resume.filePath}</p><p className={`mt-2 font-medium ${resume.active && file?.usable ? "text-emerald-700" : "text-amber-800"}`}>{resume.active ? file?.usable ? "Active and usable" : file?.issue : "Inactive"}</p></div><div className="flex items-center gap-3"><form action={setResumeActive.bind(null, resume.id, !resume.active)}><button className="rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-700 hover:border-slate-500" type="submit">{resume.active ? "Deactivate" : "Activate"}</button></form><DeleteResumeForm action={deleteResume.bind(null, resume.id)} /></div></div>
                        </li>
                      );
                    })}
                  </ul>
                ) : <p className="mt-4 text-sm text-slate-600">No resume registered.</p>}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
