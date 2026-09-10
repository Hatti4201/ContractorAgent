import Link from "next/link";
import { analyzeInboxMessage, discardIntake } from "@/app/(protected)/intake/actions";
import { DiscardIntakeForm } from "@/components/delete-job-form";
import { IntakeForm } from "@/components/intake-form";
import { requireAuth } from "@/lib/auth";
import { formatDateTime, formatEnum, intakeStates } from "@/lib/job-values";
import { queuedIntakes } from "@/services/intake-queue";
import { getPrisma } from "@/lib/prisma";
import { outlookAccessToken, outlookConnected } from "@/services/outlook-auth";
import { listOutlookInboxMessages } from "@/services/outlook-graph";
import { intakeScanMode } from "@/services/intake-scan";

export default async function IntakePage({ searchParams }: { searchParams: Promise<{ discarded?: string; error?: string }> }) {
  await requireAuth();
  const [{ discarded, error }, queue] = await Promise.all([searchParams, queuedIntakes()]);

  // FR-01's fourth source: the mailbox is only ever listed here, and only the user starts an import.
  let inbox: Awaited<ReturnType<typeof listOutlookInboxMessages>> = [];
  let inboxFailed = false;
  if (await outlookConnected()) {
    try { inbox = (await listOutlookInboxMessages({ accessToken: await outlookAccessToken() })).slice().reverse(); } catch { inboxFailed = true; }
  }
  const scanMode = intakeScanMode();
  const decisions = scanMode === "off" ? [] : await getPrisma().intakeScanDecision.findMany({
    orderBy: { createdAt: "desc" },
    take: 15,
    select: { id: true, fromAddress: true, subject: true, imported: true, confidence: true, reason: true, receivedAt: true },
  });
  const imported = new Set((await getPrisma().jobIntake.findMany({
    where: { sourceMessageId: { in: inbox.map((message) => message.id) } },
    select: { sourceMessageId: true },
  })).flatMap((intake) => (intake.sourceMessageId ? [intake.sourceMessageId] : [])));

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <Link className="text-sm font-medium text-emerald-700 underline" href="/jobs">← All jobs</Link>
      <p className="mt-4 text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Add job</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Add job</h1>

      {discarded && <p className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-900" role="status">Pasted source discarded.</p>}
      {error && <p className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800" role="alert">That source is no longer waiting for review.</p>}

      {queue.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xl font-semibold text-slate-950">Waiting for your review</h2>
          <ul className="mt-5 space-y-3">
            {queue.map((intake) => (
              <li className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" key={intake.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link className="font-semibold text-slate-950 underline" href={`/intakes/${intake.id}/review`}>{intake.title}</Link>
                    <p className="mt-1 text-sm text-slate-600">{formatEnum(intake.sourceType)} · {formatDateTime(intake.createdAt)} UTC</p>
                    {intake.detail && <p className="mt-2 text-sm text-amber-900">{intake.detail}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${intakeStates[intake.state]!.tone}`}>{intakeStates[intake.state]!.label}</span>
                    <DiscardIntakeForm action={discardIntake.bind(null, intake.id)} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8 scroll-mt-6" id="inbox">
        <h2 className="text-xl font-semibold text-slate-950">Take one straight from your inbox</h2>
        {inboxFailed && <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Outlook could not be read just now. Reconnect and reload.</p>}
        {!inboxFailed && inbox.length === 0 && <p className="mt-4 text-sm text-slate-600"><Link className="font-medium text-emerald-700 underline" href="/outlook">Connect Outlook</Link> to list recent mail here.</p>}
        {inbox.length > 0 && (
          <ul className="mt-4 space-y-2">
            {inbox.map((message) => (
              <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4" key={message.id}>
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-950">{message.subject}</p>
                  <p className="mt-1 truncate text-sm text-slate-600">{message.fromAddress} · {formatDateTime(message.receivedAt)} UTC</p>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-500">{message.preview}</p>
                </div>
                {imported.has(message.id)
                  ? <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">Already taken</span>
                  : <form action={analyzeInboxMessage.bind(null, message.id)}><button className="shrink-0 rounded-lg border border-slate-400 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:border-slate-600" type="submit">Analyze this mail</button></form>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {scanMode !== "off" && (
        <section className="mt-8">
          <h2 className="text-xl font-semibold text-slate-950">What the scan decided</h2>
          <p className="mt-1 text-sm text-slate-600">
            {scanMode === "dryrun"
              ? "Dry run: the scan judges new mail and records it here, and imports nothing."
              : "The scan turns a recruiter's new role into a pending source above; everything it judged is listed here."}
          </p>
          {decisions.length ? (
            <ul className="mt-4 space-y-2">
              {decisions.map((decision) => (
                <li className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4" key={decision.id}>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-950">{decision.subject}</p>
                    <p className="mt-1 truncate text-sm text-slate-600">{decision.fromAddress} · {formatDateTime(decision.receivedAt)} UTC</p>
                    <p className="mt-1 text-xs text-slate-500">{decision.reason}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${decision.imported ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>
                    {decision.imported ? "Taken in" : "Passed over"} · {Math.round(decision.confidence * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-4 text-sm text-slate-600">Nothing judged yet.</p>}
        </section>
      )}

      <h2 className="mt-10 text-xl font-semibold text-slate-950">Or paste the text yourself</h2>
      <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6"><IntakeForm /></div>


    </div>
  );
}
