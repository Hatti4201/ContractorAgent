import { logoutAction } from "@/app/(protected)/actions";
import { Navigation } from "@/components/navigation";
import { requireAuth } from "@/lib/auth";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  await requireAuth();

  return (
    <>
      <Navigation logoutAction={logoutAction} />
      <main>{children}</main>
    </>
  );
}
