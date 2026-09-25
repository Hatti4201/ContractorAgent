"use client";

import Link from "next/link";
import { ArrowRight, ChevronDown, ChevronUp } from "lucide-react";
import { useState, type ReactNode } from "react";

export type PerformanceRowView = { id: string; name: string; href: string; values: number[] };

const PREVIEW = 3;

/** The top three rows; the rest open in place. `more` links the page that owns the full list, if any. */
export function PerformanceTable({ title, icon, columns, rows, more }: {
  title: string;
  /** Rendered on the server: a component cannot cross into a client component, an element can. */
  icon: ReactNode;
  columns: Array<{ key: string; label: string; tip: string }>;
  rows: PerformanceRowView[];
  more?: string;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, PREVIEW);
  const hidden = rows.length - PREVIEW;

  return (
    <section aria-label={title}>
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-950">{icon}{title}</h2>
        {more && (
          <Link aria-label={`All ${title.toLowerCase()}`} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-950" href={more} title="See all">
            <ArrowRight aria-hidden="true" size={17} />
          </Link>
        )}
      </div>
      <div className="mt-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        {rows.length ? (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium" scope="col"><span className="sr-only">Name</span></th>
                {columns.map((column) => <th className="px-2 py-2 text-right font-medium" key={column.key} scope="col" title={column.tip}>{column.label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((row) => (
                <tr key={row.id}>
                  <td className="max-w-40 truncate px-3 py-2 font-medium"><Link className="text-slate-900 hover:text-emerald-700" href={row.href} title={`Filter the dashboard to ${row.name}`}>{row.name}</Link></td>
                  {row.values.map((value, index) => <td className={`px-2 py-2 text-right ${value ? "text-slate-800" : "text-slate-300"}`} key={columns[index]!.key}>{value}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="p-4 text-center text-sm text-slate-400">—</p>}
      </div>
      {hidden > 0 && (
        <button className="mt-1 ml-auto flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-slate-950" onClick={() => setAll(!all)} title={all ? "Show fewer" : "Show all"} type="button">
          {all ? <ChevronUp aria-hidden="true" size={15} /> : <>+{hidden} <ChevronDown aria-hidden="true" size={15} /></>}
        </button>
      )}
    </section>
  );
}
