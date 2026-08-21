import Link from "next/link";
import { createJob } from "@/app/(protected)/jobs/actions";
import { JobForm } from "@/components/job-form";

export default function NewJobPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <Link className="text-sm font-medium text-emerald-700 underline" href="/jobs">← All jobs</Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">Add opportunity</h1>
      <p className="mt-2 text-slate-600">Enter confirmed facts only, or <Link className="font-medium text-emerald-700 underline" href="/intake">analyze a pasted JD first</Link>.</p>
      <div className="mt-8"><JobForm action={createJob} submitLabel="Create job" /></div>
    </div>
  );
}
