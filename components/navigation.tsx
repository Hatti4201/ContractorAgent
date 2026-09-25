import Image from "next/image";
import { LogOut } from "lucide-react";
import { HomeLink, NavigationLinks } from "@/components/navigation-links";

export function Navigation({ logoutAction, attentionCount, intakeCount }: { logoutAction: () => Promise<void>; attentionCount: number; intakeCount: number }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <nav aria-label="Primary navigation" className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-2 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <HomeLink>
            <Image alt="" height={30} priority src="/mark.svg" width={30} />
            <span className="hidden lg:inline">Contractor Agent</span>
          </HomeLink>
          <NavigationLinks counts={{ intake: intakeCount, attention: attentionCount }} />
        </div>
        <form action={logoutAction} className="shrink-0">
          <button aria-label="Sign out" className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-950" title="Sign out" type="submit">
            <LogOut aria-hidden="true" size={18} />
          </button>
        </form>
      </nav>
    </header>
  );
}
