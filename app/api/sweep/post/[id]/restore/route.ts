import { isAuthenticated } from "@/lib/auth";
import { restoreSweepPost, SweepInputError } from "@/services/sweep";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await isAuthenticated()) return Response.json({ error: "Sign in first." }, { status: 401 });
  try {
    const { id } = await context.params;
    await restoreSweepPost(id);
    return Response.redirect(new URL("/sweep", _request.url), 303);
  } catch (error) {
    if (error instanceof SweepInputError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
