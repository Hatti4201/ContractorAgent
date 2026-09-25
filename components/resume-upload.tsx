"use client";

import { useRef, useState } from "react";

const inputClass = "mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";

export function ResumeUpload({
  action,
  from,
  roleFamily,
  roleLabel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  from: string | null;
  roleFamily: string;
  roleLabel: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");

  function clearFile() {
    if (input.current) input.current.value = "";
    setFileName("");
  }

  return (
    <form action={action} className="w-full">
      <input name="roleFamily" type="hidden" value={roleFamily} />
      {from && <input name="from" type="hidden" value={from} />}
      <input
        ref={input}
        accept=".pdf,.docx,.doc"
        className="sr-only"
        name="file"
        onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")}
        required
        type="file"
      />
      {!fileName ? (
        <div className="flex justify-end">
          <button className="rounded-lg border border-slate-300 px-3 py-2 text-lg font-semibold leading-none text-slate-700 hover:border-emerald-600 hover:text-emerald-700" onClick={() => input.current?.click()} type="button" aria-label={`Add resume to ${roleLabel}`}>
            +
          </button>
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-medium text-emerald-900">Selected: {fileName}</p>
          <p className="mt-1 text-xs text-emerald-800">Role family: {roleLabel}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium text-slate-800">Name <span aria-hidden="true" className="text-red-700">*</span><input className={inputClass} maxLength={200} name="name" required /></label>
            <label className="text-sm font-medium text-slate-800">Version <span aria-hidden="true" className="text-red-700">*</span><input className={inputClass} maxLength={100} name="version" required /></label>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-3 text-sm font-medium text-slate-800"><input className="h-4 w-4" name="active" type="checkbox" />Enable now</label>
            <button className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800" type="submit">Register resume</button>
            <button className="text-sm font-medium text-slate-600 underline" onClick={clearFile} type="button">Choose another</button>
          </div>
        </div>
      )}
    </form>
  );
}
