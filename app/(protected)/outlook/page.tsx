import { disconnectOutlook } from "@/app/(protected)/outlook/actions";
import { outlookConnected, outlookEnvironmentConfigured } from "@/services/outlook-auth";

export default async function OutlookPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const [{ status }, connected] = await Promise.all([searchParams, outlookConnected()]);
  const configured = outlookEnvironmentConfigured();
  const notice = status === "connected" ? "Outlook connected." : status ? "Outlook connection failed. Check the app registration and try again." : null;

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Phase 7</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Outlook connection</h1>
      <p className="mt-2 text-slate-600">Delegated Mail.ReadWrite only. The application can prepare and verify drafts, but it has no Mail.Send permission.</p>
      {notice && <p className={`mt-6 rounded-xl p-4 text-sm font-medium ${status === "connected" ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`}>{notice}</p>}
      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">Configuration</dt><dd className="mt-1 font-semibold text-slate-950">{configured ? "Ready" : "Missing"}</dd></div>
          <div><dt className="text-slate-500">Connection</dt><dd className="mt-1 font-semibold text-slate-950">{connected ? "Connected" : "Not connected"}</dd></div>
          <div><dt className="text-slate-500">Permission</dt><dd className="mt-1 font-semibold text-slate-950">Mail.ReadWrite (delegated)</dd></div>
          <div><dt className="text-slate-500">Send permission</dt><dd className="mt-1 font-semibold text-emerald-800">Not requested</dd></div>
        </dl>
        <div className="mt-6 flex flex-wrap gap-3">
          {configured && <a className="rounded-lg bg-slate-950 px-4 py-2.5 font-medium text-white hover:bg-slate-800" href="/api/outlook/connect">{connected ? "Reconnect Outlook" : "Connect Outlook"}</a>}
          {connected && <form action={disconnectOutlook}><button className="rounded-lg border border-slate-400 bg-white px-4 py-2.5 font-medium text-slate-800" type="submit">Disconnect locally</button></form>}
        </div>
        {!configured && <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Set the Microsoft application and token-encryption environment variables before connecting.</p>}
      </section>
    </div>
  );
}
