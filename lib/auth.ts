import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSessionToken, isSessionTokenValid, passwordsMatch } from "@/lib/session-token";

const COOKIE_NAME = "contractor_session";
const SESSION_LENGTH_MS = 7 * 24 * 60 * 60 * 1000;

function requiredEnvironmentVariable(name: "APP_PASSWORD" | "SESSION_SECRET") {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  if (name === "APP_PASSWORD" && value.length < 12) throw new Error("APP_PASSWORD must contain at least 12 characters.");
  if (name === "SESSION_SECRET" && value.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
  return value;
}

export function isPasswordValid(candidate: string) {
  return passwordsMatch(candidate, requiredEnvironmentVariable("APP_PASSWORD"));
}

export async function createSession() {
  const expiresAt = Date.now() + SESSION_LENGTH_MS;
  const token = createSessionToken(expiresAt, requiredEnvironmentVariable("SESSION_SECRET"));
  const cookieStore = await cookies();

  // ponytail: one shared-password session is the ceiling for this single-user app;
  // replace it with managed identity before adding users or exposing the app publicly.
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: SESSION_LENGTH_MS / 1000,
    path: "/",
  });
}

export async function deleteSession() {
  (await cookies()).delete(COOKIE_NAME);
}

export async function isAuthenticated() {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  return isSessionTokenValid(token, requiredEnvironmentVariable("SESSION_SECRET"));
}

export async function requireAuth() {
  if (!await isAuthenticated()) redirect("/login");
}
