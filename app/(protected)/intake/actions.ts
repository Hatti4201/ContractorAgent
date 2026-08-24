"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { IntakeStatus } from "@/app/generated/prisma/enums";
import { requireAuth } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

export async function discardIntake(id: string) {
  await requireAuth();
  // Only an intake the user never confirmed can be dropped; a confirmed one owns an opportunity.
  const removed = await getPrisma().jobIntake.deleteMany({ where: { id, status: IntakeStatus.PENDING } });
  if (removed.count !== 1) redirect("/intake?error=missing");
  revalidatePath("/intake");
  redirect("/intake?discarded=1");
}
