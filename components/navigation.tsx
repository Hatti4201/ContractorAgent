import Image from "next/image";
import Link from "next/link";

export function Navigation({ logoutAction }: { logoutAction: () => Promise<void> }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <nav
        aria-label="Primary navigation"
        className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4"
      >
        <div className="flex items-center gap-7">
          <Link className="flex items-center gap-3 font-semibold text-slate-950" href="/dashboard">
            <Image alt="" height={32} priority src="/mark.svg" width={32} />
            Contractor Agent
          </Link>
          <div className="hidden items-center gap-5 text-sm font-medium text-slate-600 sm:flex">
            <Link className="hover:text-slate-950" href="/intake">Add job</Link>
            <Link className="hover:text-slate-950" href="/needs-attention">Needs attention</Link>
            <Link className="hover:text-slate-950" href="/jobs">Jobs</Link>
            <Link className="hover:text-slate-950" href="/recruiters">Recruiters</Link>
            <Link className="hover:text-slate-950" href="/resumes">Resumes</Link>
            <Link className="hover:text-slate-950" href="/outlook">Outlook</Link>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800 sm:inline">
            Phase 8
          </span>
          <form action={logoutAction}>
            <button className="text-sm font-medium text-slate-600 hover:text-slate-950" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </nav>
    </header>
  );
}
