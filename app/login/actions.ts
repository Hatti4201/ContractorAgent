"use server";

import { redirect } from "next/navigation";
import { createSession, isPasswordValid } from "@/lib/auth";

export async function loginAction(formData: FormData) {
  const password = formData.get("password");
  if (typeof password !== "string" || !isPasswordValid(password)) redirect("/login?error=1");

  await createSession();
  redirect("/dashboard");
}
