import { after } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { MAX_SWEEP_LENGTH } from "@/lib/linkedin-feed";
import { startSweep, SweepInputError } from "@/services/sweep";

/** A whole LinkedIn page pasted into LinkedIn Sweep; screening and preparing run behind the response. */
export async function POST(request: Request) {
  if (!await isAuthenticated()) return Response.json({ error: "Sign in first." }, { status: 401 });
  // UTF-8 can take up to four bytes a character; the character limit below is the real one.
  if (Number(request.headers.get("content-length") ?? 0) > MAX_SWEEP_LENGTH * 4) return Response.json({ error: "The paste is too large." }, { status: 413 });

  let text: string;
  try {
    const value: unknown = await request.json();
    const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
    text = typeof input?.text === "string" ? input.text : "";
    if (!text.trim()) throw new Error();
  } catch {
    return Response.json({ error: "Paste the LinkedIn page first." }, { status: 400 });
  }
  if (text.length > MAX_SWEEP_LENGTH) return Response.json({ error: "The paste is too large. Load fewer pages of results." }, { status: 413 });

  try {
    const id = await startSweep(text, after);
    return Response.json({ id }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SweepInputError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
