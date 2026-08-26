import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-6 py-24 text-center">
      <h1 className="text-3xl font-semibold text-slate-950">Page not found</h1>
      <p className="mt-3 text-slate-600">That page does not exist, or the record it needed has been removed.</p>
      <Link className="mt-6 inline-block font-medium text-emerald-700 underline" href="/dashboard">
        Return to dashboard
      </Link>
    </div>
  );
}
