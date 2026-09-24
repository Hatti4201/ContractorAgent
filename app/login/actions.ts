"use server";

import { redirect } from "next/navigation";
import { createSession, isPasswordValid } from "@/lib/auth";

export async function loginAction(formData: FormData) {
  const password = formData.get("password");
  const next = formData.get("next") === "capture" ? "&next=capture" : "";
  if (typeof password !== "string" || !isPasswordValid(password)) redirect(`/login?error=1${next}`);

  await createSession();
  // Only the capture page may be returned to, and only by name, so the parameter cannot become an open redirect.
  redirect(formData.get("next") === "capture" ? "/capture" : "/dashboard");
}
