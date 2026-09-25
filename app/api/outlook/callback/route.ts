import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { AutopilotSetting } from "@/app/generated/prisma/enums";
import { setAutopilotSetting } from "@/services/auto-send";
import { completeOutlookAuthorization, outlookSendToken } from "@/services/outlook-auth";

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
  const forSending = cookieStore.get("outlook_oauth_send")?.value === "1";
  cookieStore.set("outlook_oauth_send", "", { maxAge: 0, path: "/api/outlook/callback" });
  cookieStore.set("outlook_oauth_state", "", { maxAge: 0, path: "/api/outlook/callback" });
  cookieStore.set("outlook_oauth_verifier", "", { maxAge: 0, path: "/api/outlook/callback" });
  const destination = new URL("/outlook", request.url);

  if (!code || !state || !expectedState || !verifier || !matches(state, expectedState)) {
    destination.searchParams.set("status", "invalid_callback");
    return Response.redirect(destination);
  }
  try {
    await completeOutlookAuthorization(code, verifier, forSending);
    destination.searchParams.set("status", "connected");
  } catch {
    destination.searchParams.set("status", "connection_failed");
    return Response.redirect(destination);
  }
  if (forSending) {
    // Switched on only when Outlook really granted it; declining the permission leaves the switch alone.
    const back = new URL("/dashboard", request.url);
    back.hash = "autopilot";
    try {
      await outlookSendToken();
      await setAutopilotSetting(AutopilotSetting.SEND);
      back.searchParams.set("autopilot", "send");
    } catch {
      back.searchParams.set("autopilot", "send-refused");
    }
    return Response.redirect(back);
  }
  return Response.redirect(destination);
}
