import Link from "next/link";
import { createRoleFamily, deleteResume, registerResume, setResumeActive, setRoleFamilyActive } from "@/app/(protected)/resumes/actions";
import { DeleteResumeForm } from "@/components/delete-job-form";
import { ResumeUpload } from "@/components/resume-upload";
import { getPrisma } from "@/lib/prisma";
import { checkResumeFile } from "@/services/resume-router";
import { allRoleFamilies } from "@/services/role-family";

const inputClass = "mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";
const errors: Record<string, string> = {
  fields: "Complete every field with a valid value.",
  file: "Choose a readable PDF, DOCX, or DOC file no larger than 25 MB.",
  duplicate: "That resume name and version already exist.",
  missing: "That registry entry no longer exists.",
  "in-use": "This resume is attached to an outreach draft and cannot be deleted until that draft is removed.",
  "family-code": "Code must be 2 to 40 characters of A-Z, 0-9 and underscore, and start with a letter.",
  "family-fields": "A role family needs a label and a one-line description.",
  "family-duplicate": "That role family code already exists.",
};

export default async function ResumesPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; from?: string }> }) {
  const { error, saved, from } = await searchParams;
  const back = typeof from === "string" && /^\/jobs\/[a-z0-9]{20,40}$/.test(from) ? from : null;
  const resumes = await getPrisma().resume.findMany({ orderBy: [{ roleFamily: "asc" }, { active: "desc" }, { updatedAt: "desc" }] });
  // Every family, so a deactivated one still shows the resumes filed under it.
  const families = await allRoleFamilies();
  const fileChecks = new Map(await Promise.all(resumes.map(async (resume) => [resume.id, await checkResumeFile(resume.filePath)] as const)));

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Resumes</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Resume registry</h1>
      {back && <p className="mt-4 text-sm text-slate-700">Registering here returns you to the job you came from. <Link className="font-medium text-emerald-700 underline" href={`${back}#resume-router`}>Go back without adding</Link>.</p>}

      {saved && <p className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-900" role="status">Registry updated.</p>}
      {error && <p className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800" role="alert">{errors[error] ?? "Registry update failed."}</p>}

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-950">Role families</h2>
        <p className="mt-2 text-sm text-slate-600">The description is what tells the analyzer this family apart from the others, so write it the way you would explain the difference to a person.</p>
        <form action={createRoleFamily} className="mt-5 grid gap-5 md:grid-cols-3">
          <label className="text-sm font-medium text-slate-800">Code <span aria-hidden="true" className="text-red-700">*</span><input className={inputClass} maxLength={40} name="code" placeholder="PYTHON_REACT" required /></label>
          <label className="text-sm font-medium text-slate-800">Label <span aria-hidden="true" className="text-red-700">*</span><input className={inputClass} maxLength={100} name="label" placeholder="Python + React" required /></label>
          <label className="text-sm font-medium text-slate-800">What separates it <span aria-hidden="true" className="text-red-700">*</span><input className={inputClass} maxLength={500} name="description" placeholder="Python backend with a React front end." required /></label>
          <button className="w-fit rounded-lg bg-slate-950 px-5 py-3 font-medium text-white hover:bg-slate-800 md:col-span-3" type="submit">Add role family</button>
        </form>
        <ul className="mt-6 space-y-3">
          {families.map((family) => (
            <li className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 p-4 text-sm" key={family.code}>
              <div>
                <p className="font-semibold text-slate-950">{family.label} <span className="font-mono text-xs font-normal text-slate-500">{family.code}</span></p>
                <p className="mt-1 text-slate-600">{family.description}</p>
              </div>
              <form action={setRoleFamilyActive.bind(null, family.code, !family.active)}>
                <button className="rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-700 hover:border-slate-500" type="submit">{family.active ? "Deactivate" : "Activate"}</button>
              </form>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold text-slate-950">By role family</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {families.map((role) => {
            const entries = resumes.filter((resume) => resume.roleFamily === role.code);
            return (
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" key={role.code}>
                <div className="flex items-center justify-between gap-3"><h3 className="font-semibold text-slate-950">{role.label}{!role.active && <span className="ml-2 text-xs font-medium text-slate-500">Inactive</span>}</h3><div className="flex items-center gap-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${entries.some((resume) => resume.active && fileChecks.get(resume.id)?.usable) ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>{entries.some((resume) => resume.active && fileChecks.get(resume.id)?.usable) ? "Ready" : "Needs file"}</span>{role.active && <span className="text-xs text-slate-500">+ to add</span>}</div></div>
                {role.active && <ResumeUpload action={registerResume} from={back} roleFamily={role.code} roleLabel={role.label} />}
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
