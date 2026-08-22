import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { completeOutlookAuthorization } from "@/services/outlook-auth";

export const dynamic = "force-dynamic";

function matches(left: string, right: string) {
  return left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("outlook_oauth_state")?.value ?? "";
  const verifier = cookieStore.get("outlook_oauth_verifier")?.value ?? "";
  cookieStore.set("outlook_oauth_state", "", { maxAge: 0, path: "/api/outlook/callback" });
  cookieStore.set("outlook_oauth_verifier", "", { maxAge: 0, path: "/api/outlook/callback" });
  const destination = new URL("/outlook", request.url);

  if (!code || !state || !expectedState || !verifier || !matches(state, expectedState)) {
    destination.searchParams.set("status", "invalid_callback");
    return Response.redirect(destination);
  }
  try {
    await completeOutlookAuthorization(code, verifier);
    destination.searchParams.set("status", "connected");
  } catch {
    destination.searchParams.set("status", "connection_failed");
  }
  return Response.redirect(destination);
}
