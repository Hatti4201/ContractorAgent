"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { IntakeStatus } from "@/app/generated/prisma/enums";
import { requireAuth } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

// A bound argument still arrives from the client, so the return page is chosen from a fixed set.
const returnPages = new Set(["/intake", "/dashboard"]);

export async function discardIntake(id: string, returnTo = "/intake") {
  await requireAuth();
  const back = returnPages.has(returnTo) ? returnTo : "/intake";
  // Only an intake the user never confirmed can be dropped; a confirmed one owns an opportunity.
  const removed = await getPrisma().jobIntake.deleteMany({ where: { id, status: IntakeStatus.PENDING } });
  if (removed.count !== 1) redirect(`${back}?error=missing`);
  revalidatePath("/intake");
  revalidatePath("/dashboard");
  redirect(`${back}?discarded=1`);
}
