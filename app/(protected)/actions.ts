"use server";

import { redirect } from "next/navigation";
import { deleteSession } from "@/lib/auth";

export async function logoutAction() {
  await deleteSession();
  redirect("/login");
}
