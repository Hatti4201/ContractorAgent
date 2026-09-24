import type { Metadata } from "next";
import { CaptureSubmitter } from "@/components/capture-submitter";

export const metadata: Metadata = { title: "Send to agent" };

/**
 * Outside the protected layout on purpose: the session cookie is SameSite=Strict, so the navigation
 * that LinkedIn's tab starts arrives without it. The page's own request back to the app is same-site
 * and carries it, so the check happens there, in /api/capture.
 */
export default function CapturePage() {
  return (
    <main className="grid min-h-screen place-items-center px-6 py-16">
      <CaptureSubmitter />
    </main>
  );
}
