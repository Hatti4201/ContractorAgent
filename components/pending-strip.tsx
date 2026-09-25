"use client";

import Link from "next/link";
import { ArrowRight, ExternalLink, Eye, Loader, MailOpen, RefreshCw, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { DiscardIntakeCross } from "@/components/delete-job-form";

export type PendingItem = {
  id: string;
  title: string;
  href: string;
  /** Shown on hover, never as a line of its own. */
  tip: string | null;
  dot: "green" | "amber" | "red" | "slate" | "sky";
  match?: number | null;
  outlookLink?: string | null;
  discard?: () => Promise<void>;
};

type Card = { key: string; label: string; icon: LucideIcon; tone: string; items: PendingItem[]; more?: string; action?: { run: () => Promise<void>; label: string } };

const dots = { green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-red-500", slate: "bg-slate-400", sky: "bg-sky-500" } as const;
const PREVIEW = 8;

/**
 * Three counts in a row: emails being prepared, drafts in Outlook, jobs to review. A card opens its
 * list below; the review list's full length lives on the Add job page.
 */
export function PendingStrip({ preparing, inOutlook, review, checkSent }: {
  preparing: PendingItem[];
  inOutlook: PendingItem[];
  review: PendingItem[];
  checkSent: () => Promise<void>;
}) {
  const cards: Card[] = [
    { key: "preparing", label: "Preparing", icon: Loader, tone: "text-slate-600", items: preparing },
    { key: "outlook", label: "In Outlook", icon: MailOpen, tone: "text-blue-600", items: inOutlook, action: { run: checkSent, label: "Check which were sent" } },
    { key: "review", label: "To review", icon: Eye, tone: "text-amber-600", items: review, more: "/intake" },
  ];
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const current = cards.find((card) => card.key === open);
  const shown = current ? (all ? current.items : current.items.slice(0, PREVIEW)) : [];
  const hidden = current ? current.items.length - shown.length : 0;

  return (
    <section aria-label="Pending work" className="mt-4">
      <div className="grid grid-cols-3 gap-3">
        {cards.map((card) => {
          const Icon = card.icon;
          const active = open === card.key;
          return (
            <button
              aria-expanded={active}
              className={`flex items-center justify-between rounded-2xl border bg-white px-4 py-3 text-left shadow-sm transition-colors disabled:cursor-default disabled:opacity-50 ${active ? "border-slate-900 ring-2 ring-slate-200" : "border-slate-200 hover:border-slate-400"}`}
              disabled={!card.items.length}
              key={card.key}
              onClick={() => { setOpen(active ? null : card.key); setAll(false); }}
              title={card.label}
              type="button"
            >
              <span className="flex items-center gap-2 text-sm font-medium text-slate-600">
                <Icon aria-hidden="true" className={card.tone} size={18} />
                <span className="max-sm:sr-only">{card.label}</span>
              </span>
              <span className="text-2xl font-semibold text-slate-950">{card.items.length}</span>
            </button>
          );
        })}
      </div>

      {current && (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3">
          {current.action && (
            <form action={current.action.run} className="mb-2 flex justify-end">
              <button aria-label={current.action.label} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" title={current.action.label} type="submit">
                <RefreshCw aria-hidden="true" size={15} />
              </button>
            </form>
          )}
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {shown.map((item) => (
              <li className="group relative" key={item.id}>
                {item.discard && <DiscardIntakeCross action={item.discard} title={item.title} />}
                <Link className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 hover:border-slate-500" href={item.href} title={item.tip ?? undefined}>
                  <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${dots[item.dot]}`} />
                  <span className="truncate pr-4 text-sm font-medium text-slate-900">{item.title}</span>
                  {item.match != null && <span className="ml-auto shrink-0 text-xs font-semibold text-slate-500">{Math.round(item.match * 100)}%</span>}
                </Link>
                {item.outlookLink && (
                  <a aria-label={`Open ${item.title} in Outlook`} className="absolute bottom-2 right-2 text-blue-600" href={item.outlookLink} rel="noreferrer" target="_blank" title="Open in Outlook">
                    <ExternalLink aria-hidden="true" size={13} />
                  </a>
                )}
              </li>
            ))}
          </ul>
          {hidden > 0 && (current.more
            ? (
              <Link className="mt-2 flex items-center justify-end gap-1 text-sm font-semibold text-slate-600 hover:text-slate-950" href={current.more} title="See all">
                +{hidden} <ArrowRight aria-hidden="true" size={15} />
              </Link>
            )
            : (
              <button className="mt-2 ml-auto flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-950" onClick={() => setAll(true)} title="Show all" type="button">
                +{hidden}
              </button>
            ))}
        </div>
      )}
    </section>
  );
}
