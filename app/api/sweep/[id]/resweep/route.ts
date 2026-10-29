import { after } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { resweepSweep, SweepInputError } from "@/services/sweep";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await isAuthenticated()) return Response.json({ error: "Sign in first." }, { status: 401 });
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as { scope?: unknown; postId?: unknown };
    const postId = typeof body.postId === "string" && body.postId.length <= 64 ? body.postId : undefined;
    const count = await resweepSweep(id, after, body.scope === "needs" ? "needs" : "all", postId);
    return Response.json({ count }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SweepInputError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
