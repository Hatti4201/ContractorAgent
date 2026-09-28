"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, FileText, Mail, Plus, Radar, ScanSearch, TriangleAlert, Users, type LucideIcon } from "lucide-react";

export type NavigationCounts = { intake: number; attention: number };

type Item = { href: string; label: string; icon: LucideIcon; badge?: keyof NavigationCounts; accent?: boolean; divider?: boolean };

// Icons are chosen here, in the client component, because a component cannot be handed across from the server.
const items: Item[] = [
  { href: "/intake", label: "Add job", icon: Plus, accent: true, badge: "intake" },
  { href: "/sweep", label: "Sweep", icon: ScanSearch },
  { href: "/needs-attention", label: "Attention", icon: TriangleAlert, badge: "attention" },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/recruiters", label: "Recruiters", icon: Users },
  { href: "/exposure", label: "Exposure", icon: Radar },
  // Everything past here is setup rather than daily work.
  { href: "/resumes", label: "Resumes", icon: FileText, divider: true },
  { href: "/outlook", label: "Outlook", icon: Mail },
];

// A section is current when the path is that route or anything under it, so a job detail page still
// marks Jobs, and the home logo stays marked while on the dashboard.
export function isCurrent(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Icons, with the word shown only for the page you are on, so the bar never wraps; every other word
 * is the tooltip. On a phone the row scrolls instead of disappearing.
 */
export function NavigationLinks({ counts }: { counts: NavigationCounts }) {
  const pathname = usePathname();

  return (
    <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto text-sm font-medium">
      {items.map((item) => {
        const current = isCurrent(pathname, item.href);
        const count = item.badge ? counts[item.badge] : 0;
        const Icon = item.icon;
        return (
          <span className="flex shrink-0 items-center" key={item.href}>
            {item.divider && <span aria-hidden="true" className="mx-1.5 h-4 w-px bg-slate-200" />}
            <Link
              aria-current={current ? "page" : undefined}
              aria-label={count ? `${item.label}: ${count}` : item.label}
              className={`relative flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-2 transition-colors ${
                current
                  ? "bg-slate-100 text-slate-950"
                  : item.accent
                    ? "text-emerald-700 hover:bg-emerald-50"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-950"
              }`}
              href={item.href}
              title={item.label}
            >
              <Icon aria-hidden="true" size={18} />
              {current && <span className="max-sm:hidden">{item.label}</span>}
              {count > 0 && (
                <span className={`rounded-full px-1.5 text-xs font-semibold leading-5 ${item.badge === "attention" ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}>{count}</span>
              )}
            </Link>
          </span>
        );
      })}
    </div>
  );
}

export function HomeLink({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <Link
      aria-current={isCurrent(pathname, "/dashboard") ? "page" : undefined}
      aria-label="Dashboard"
      className={`flex shrink-0 items-center gap-3 rounded-lg px-2 py-1.5 font-semibold transition-colors ${
        isCurrent(pathname, "/dashboard") ? "bg-slate-100 text-slate-950" : "text-slate-950 hover:bg-slate-50"
      }`}
      href="/dashboard"
      title="Dashboard"
    >
      {children}
    </Link>
  );
}
