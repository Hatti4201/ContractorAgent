import Link from "next/link";
import { createRoleFamily, deleteResume, registerResume, setResumeActive, setRoleFamilyActive, updateRoleFamilyDescription } from "@/app/(protected)/resumes/actions";
import { DeleteResumeForm } from "@/components/delete-job-form";
import { InlineDescription } from "@/components/inline-description";
import { ResumeUpload } from "@/components/resume-upload";
import { getPrisma } from "@/lib/prisma";
import { checkResumeFile } from "@/services/resume-router";
import { allRoleFamilies } from "@/services/role-family";

const inputClass = "mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";
const errors: Record<string, string> = {
  fields: "Complete every field with a valid value.",
  file: "Choose a readable PDF, DOCX, or DOC file no larger than 25 MB.",
  duplicate: "That resume name and version already exist.",
  missing: "That registry entry no longer exists.",
  "in-use": "This resume is attached to an outreach draft and cannot be deleted until that draft is removed.",
  "family-code": "The code must be 2 to 40 characters of A-Z, 0-9 and underscore, starting with a letter. Type one if the name has none.",
  "family-fields": "A role family needs a name and a one-line description.",
  "family-duplicate": "That role family already exists.",
};

type Family = Awaited<ReturnType<typeof allRoleFamilies>>[number];
type Resume = Awaited<ReturnType<ReturnType<typeof getPrisma>["resume"]["findMany"]>>[number];
type FileCheck = Awaited<ReturnType<typeof checkResumeFile>>;

function FamilyCard({ family, resumes, fileChecks, draftUses, back }: {
  family: Family;
  resumes: Resume[];
  fileChecks: Map<string, FileCheck>;
  draftUses: Map<string, number>;
  back: string | null;
}) {
  const ready = resumes.some((resume) => resume.active && fileChecks.get(resume.id)?.usable);
  return (
    <article className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-slate-950">{family.label}</h3>
        <div className="flex items-center gap-1">
          {family.active && (
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ready ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>{ready ? "Ready" : "Needs file"}</span>
          )}
          <details className="relative">
            <summary aria-label={`More actions for ${family.label}`} className="cursor-pointer list-none rounded px-2 py-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900">⋯</summary>
            <div className="absolute right-0 z-10 mt-1 w-40 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
              <form action={setRoleFamilyActive.bind(null, family.code, !family.active)}>
                <button className="w-full rounded px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50" type="submit">{family.active ? "Deactivate family" : "Activate family"}</button>
              </form>
            </div>
          </details>
        </div>
      </div>
      <InlineDescription action={updateRoleFamilyDescription.bind(null, family.code)} value={family.description} />

      {resumes.length ? (
        <ul className="mt-4 space-y-2">
          {resumes.map((resume) => {
            const file = fileChecks.get(resume.id);
            const uses = draftUses.get(resume.id) ?? 0;
            return (
              <li className={`rounded-lg border px-3 py-2 text-sm ${resume.active ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white"}`} key={resume.id}>
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-900" title={`${resume.name} · ${resume.version}`}>{resume.name} · {resume.version}</span>
                  {/* One switch shows the state and changes it; turning one on turns the family's other one off. */}
                  <form action={setResumeActive.bind(null, resume.id, !resume.active)}>
                    <button aria-checked={resume.active} aria-label={`Use ${resume.name} ${resume.version} for ${family.label}`} className="flex items-center gap-2 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2" role="switch" type="submit">
                      <span className={`relative block h-5 w-9 shrink-0 rounded-full transition-colors ${resume.active ? "bg-emerald-600" : "bg-slate-300"}`}>
                        <span className={`absolute left-0.5 top-0.5 block h-4 w-4 rounded-full bg-white shadow transition-transform ${resume.active ? "translate-x-4" : "translate-x-0"}`} />
                      </span>
                      <span className={`w-12 whitespace-nowrap text-left text-xs font-semibold ${resume.active ? "text-emerald-800" : "text-slate-500"}`}>{resume.active ? "In use" : "Off"}</span>
                    </button>
                  </form>
                </div>
                {!file?.usable && <p className="mt-1 text-xs text-amber-800">{file?.issue ?? "The file cannot be read."}</p>}
                <div className="mt-1.5 text-xs">
                  {uses ? (
                    <span className="text-slate-400" title="Remove those drafts first, or just switch this resume off.">Used by {uses} draft{uses === 1 ? "" : "s"} · can&apos;t delete</span>
                  ) : (
                    <DeleteResumeForm action={deleteResume.bind(null, resume.id)} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : <p className="mt-4 text-sm text-slate-500">No resume yet.</p>}

      {family.active && <div className="mt-auto"><ResumeUpload action={registerResume} from={back} roleFamily={family.code} roleLabel={family.label} /></div>}
    </article>
  );
}

export default async function ResumesPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; from?: string }> }) {
  const { error, saved, from } = await searchParams;
  const back = typeof from === "string" && /^\/jobs\/[a-z0-9]{20,40}$/.test(from) ? from : null;
  const database = getPrisma();
  const [resumes, families, draftCounts] = await Promise.all([
    database.resume.findMany({ orderBy: [{ roleFamily: "asc" }, { active: "desc" }, { updatedAt: "desc" }] }),
    // Every family, so a deactivated one still shows the resumes filed under it.
    allRoleFamilies(),
    database.outreachDraft.groupBy({ by: ["attachmentResumeId"], _count: { _all: true } }),
  ]);
  const fileChecks = new Map(await Promise.all(resumes.map(async (resume) => [resume.id, await checkResumeFile(resume.filePath)] as const)));
  const draftUses = new Map(draftCounts.map((row) => [row.attachmentResumeId, row._count._all]));
  const active = families.filter((family) => family.active);
  const inactive = families.filter((family) => !family.active);
  const card = (family: Family) => (
    <FamilyCard back={back} draftUses={draftUses} family={family} fileChecks={fileChecks} key={family.code} resumes={resumes.filter((resume) => resume.roleFamily === family.code)} />
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Resumes</h1>
        <details className="relative">
          <summary className="cursor-pointer list-none rounded-lg bg-slate-950 px-4 py-2.5 font-medium text-white hover:bg-slate-800">+ Add role</summary>
          <form action={createRoleFamily} className="absolute right-0 z-20 mt-2 grid w-80 gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
            <label className="text-sm font-medium text-slate-800">Name<input className={inputClass} maxLength={100} name="label" placeholder="Python + React" required /></label>
            <label className="text-sm font-medium text-slate-800">What separates it<textarea className={inputClass} maxLength={500} name="description" placeholder="Python backend with a React front end." required rows={3} /></label>
            <label className="text-sm font-medium text-slate-800">Code <span className="font-normal text-slate-500">(optional, from the name)</span><input className={inputClass} maxLength={40} name="code" placeholder="PYTHON_REACT" /></label>
            <button className="rounded-lg bg-slate-950 px-4 py-2 font-medium text-white hover:bg-slate-800" type="submit">Add role</button>
          </form>
        </details>
      </div>
      {back && <p className="mt-4 text-sm text-slate-700">Adding a resume here returns you to the job you came from. <Link className="font-medium text-emerald-700 underline" href={`${back}#resume-router`}>Go back without adding</Link>.</p>}

      {saved && <p className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-900" role="status">Saved.</p>}
      {error && <p className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800" role="alert">{errors[error] ?? "The update failed."}</p>}

      <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">{active.map(card)}</div>

      {inactive.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm font-medium text-slate-600">Deactivated families ({inactive.length})</summary>
          <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">{inactive.map(card)}</div>
        </details>
      )}
    </div>
  );
}
