import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { isAuthenticated } from "@/lib/auth";
import { outlookAuthorizationUrl } from "@/services/outlook-auth";

export const dynamic = "force-dynamic";

/** `?send=1` asks for Mail.Send as well: the user is turning automatic sending on. */
export async function GET(request: Request) {
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
  const forSending = new URL(request.url).searchParams.get("send") === "1";
  // The callback must redeem the code for the same scopes, and turns sending on once it is granted.
  cookieStore.set("outlook_oauth_send", forSending ? "1" : "", { ...options, maxAge: forSending ? options.maxAge : 0 });
  return Response.redirect(await outlookAuthorizationUrl(state, challenge, forSending));
}
