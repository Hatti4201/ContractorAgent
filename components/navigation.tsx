import Image from "next/image";
import Link from "next/link";

export function Navigation() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <nav
        aria-label="Primary navigation"
        className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4"
      >
        <Link className="flex items-center gap-3 font-semibold text-slate-950" href="/">
          <Image alt="" height={32} priority src="/mark.svg" width={32} />
          Contractor Agent
        </Link>
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800">
          Phase 0
        </span>
      </nav>
    </header>
  );
}
