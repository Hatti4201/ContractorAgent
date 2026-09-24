"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireAuth } from "@/lib/auth";
import { runExposure } from "@/services/exposure-run";

export async function runExposureNow() {
  await requireAuth();
  // A run takes many minutes, so it continues after the response; the page shows its records as they land.
  after(() => runExposure().then(() => undefined));
  revalidatePath("/exposure");
  redirect("/exposure");
}
