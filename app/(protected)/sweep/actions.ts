"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { reviewSkipped } from "@/services/sweep";

/** Puts a job the rules skipped back in the queue, for the user to confirm by hand. */
export async function reviewSkippedIntake(intakeId: string) {
  await requireAuth();
  if (!await reviewSkipped(intakeId)) redirect("/sweep?error=missing");
  revalidatePath("/sweep");
  revalidatePath("/intake");
  redirect(`/intakes/${intakeId}/review`);
}
