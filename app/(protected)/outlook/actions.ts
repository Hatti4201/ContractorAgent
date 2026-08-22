"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { disconnectOutlookConnection } from "@/services/outlook-auth";

export async function disconnectOutlook() {
  await requireAuth();
  await disconnectOutlookConnection();
  revalidatePath("/outlook");
}
