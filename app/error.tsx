"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl px-6 py-24 text-center">
      <h1 className="text-3xl font-semibold text-slate-950">Something went wrong</h1>
      <p className="mt-3 text-slate-600">The request could not be completed safely.</p>
      {/* This runs on one private machine, so hiding the reason only costs the user the diagnosis.
          Every message here is written by this application; none of it is user or recruiter data. */}
      {error.message && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-left text-sm font-medium text-red-900">{error.message}</p>
      )}
      {error.digest && <p className="mt-2 text-xs text-slate-500">Reference {error.digest}</p>}
      <button
        className="mt-6 rounded-lg bg-slate-950 px-4 py-2.5 font-medium text-white focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2"
        onClick={reset}
        type="button"
      >
        Try again
      </button>
    </div>
  );
}
