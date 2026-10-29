import { isAuthenticated } from "@/lib/auth";
import { syncInbox } from "@/services/intake-inbox";

export async function POST() {
  if (!await isAuthenticated()) return Response.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const snapshot = await syncInbox();
    return Response.json({ ok: true, count: snapshot?.messages.length ?? 0 }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Outlook could not be read just now." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
