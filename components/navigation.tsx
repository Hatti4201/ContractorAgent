import Image from "next/image";
import { HomeLink, NavigationLinks, type NavigationItem } from "@/components/navigation-links";

export function Navigation({ logoutAction, attentionCount, intakeCount }: { logoutAction: () => Promise<void>; attentionCount: number; intakeCount: number }) {
  const items: NavigationItem[] = [
    { href: "/intake", label: "Add job", accent: true, badge: intakeCount || undefined },
    { href: "/needs-attention", label: "Needs attention", badge: attentionCount || undefined },
    { href: "/jobs", label: "Jobs" },
    { href: "/recruiters", label: "Recruiters" },
    // Everything past here is setup rather than daily work.
    { href: "/resumes", label: "Resumes", divider: true },
    { href: "/outlook", label: "Outlook" },
  ];

  return (
    <header className="border-b border-slate-200 bg-white">
      <nav aria-label="Primary navigation" className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
        <div className="flex items-center gap-4">
          <HomeLink>
            <Image alt="" height={32} priority src="/mark.svg" width={32} />
            Contractor Agent
          </HomeLink>
          <NavigationLinks items={items} />
        </div>
        <form action={logoutAction}>
          <button className="text-sm font-medium text-slate-600 hover:text-slate-950" type="submit">Sign out</button>
        </form>
      </nav>
    </header>
  );
}
