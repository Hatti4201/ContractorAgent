import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { isAuthenticated } from "@/lib/auth";
import { outlookAuthorizationUrl } from "@/services/outlook-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!await isAuthenticated()) return new Response("Unauthorized.", { status: 401 });
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const cookieStore = await cookies();
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 10 * 60,
    path: "/api/outlook/callback",
  };
  cookieStore.set("outlook_oauth_state", state, options);
  cookieStore.set("outlook_oauth_verifier", verifier, options);
  return Response.redirect(await outlookAuthorizationUrl(state, challenge));
}
