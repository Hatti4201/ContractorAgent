import { disconnectOutlook } from "@/app/(protected)/outlook/actions";
import { outlookStatus } from "@/services/outlook-auth";

export default async function OutlookPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const [{ status }, health] = await Promise.all([searchParams, outlookStatus()]);
  const notice = status === "connected" ? "Outlook connected." : status ? "Outlook connection failed. Check the app registration and try again." : null;

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Outlook</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Outlook connection</h1>
      {notice && <p className={`mt-6 rounded-xl p-4 text-sm font-medium ${status === "connected" ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`}>{notice}</p>}
      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">Configuration</dt><dd className="mt-1 font-semibold text-slate-950">{health.configured ? "Ready" : "Missing"}</dd></div>
          <div><dt className="text-slate-500">Connection</dt><dd className={`mt-1 font-semibold ${health.readReady ? "text-emerald-800" : "text-red-800"}`}>{health.readReady ? "Connected" : "Unavailable"}</dd></div>
          <div><dt className="text-slate-500">Draft permission</dt><dd className={`mt-1 font-semibold ${health.readReady ? "text-emerald-800" : "text-red-800"}`}>{health.readReady ? "Mail.ReadWrite (delegated)" : health.readError}</dd></div>
          <div><dt className="text-slate-500">Send permission</dt><dd className={`mt-1 font-semibold ${health.sendReady ? "text-emerald-800" : "text-slate-700"}`}>{health.sendReady ? "Mail.Send (delegated)" : "Not granted"}</dd></div>
        </dl>
        <div className="mt-6 flex flex-wrap gap-3">
          {health.configured && <a className="rounded-lg bg-slate-950 px-4 py-2.5 font-medium text-white hover:bg-slate-800" href="/api/outlook/connect">{health.connected ? "Reconnect Outlook" : "Connect Outlook"}</a>}
          {health.connected && <form action={disconnectOutlook}><button className="rounded-lg border border-slate-400 bg-white px-4 py-2.5 font-medium text-slate-800" type="submit">Disconnect locally</button></form>}
        </div>
        {!health.configured && <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Set the Microsoft application and token-encryption environment variables before connecting.</p>}
        {health.readError && <p className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">Draft creation is unavailable: {health.readError}</p>}
        {!health.readError && health.sendError && <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Draft creation is available. Automatic sending is not authorized until Mail.Send is granted.</p>}
      </section>
    </div>
  );
}
