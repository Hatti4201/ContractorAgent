"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavigationItem = { href: string; label: string; badge?: number; accent?: boolean; divider?: boolean };

// A section is current when the path is that route or anything under it, so a job detail page still
// marks Jobs, and the home logo stays marked while on the dashboard.
export function isCurrent(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavigationLinks({ items }: { items: NavigationItem[] }) {
  const pathname = usePathname();

  return (
    <div className="hidden items-center gap-1 text-sm font-medium sm:flex">
      {items.map((item) => {
        const current = isCurrent(pathname, item.href);
        return (
          <span className="flex items-center" key={item.href}>
            {item.divider && <span aria-hidden="true" className="mx-2 h-4 w-px bg-slate-200" />}
            <Link
              aria-current={current ? "page" : undefined}
              className={`rounded-lg px-2.5 py-1.5 transition-colors ${
                current
                  ? "bg-slate-100 text-slate-950"
                  : item.accent
                    ? "text-emerald-700 hover:bg-emerald-50"
                    : "text-slate-600 hover:text-slate-950"
              }`}
              href={item.href}
            >
              {item.label}
              {item.badge ? (
                <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900">{item.badge}</span>
              ) : null}
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
      className={`flex items-center gap-3 rounded-lg px-2 py-1.5 font-semibold transition-colors ${
        isCurrent(pathname, "/dashboard") ? "bg-slate-100 text-slate-950" : "text-slate-950 hover:bg-slate-50"
      }`}
      href="/dashboard"
    >
      {children}
    </Link>
  );
}
