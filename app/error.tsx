"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl px-6 py-24 text-center">
      <h1 className="text-3xl font-semibold text-slate-950">Something went wrong</h1>
      <p className="mt-3 text-slate-600">The request could not be completed safely.</p>
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
