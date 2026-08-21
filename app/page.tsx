const foundations = [
  ["Web application", "Next.js, TypeScript, React, and Tailwind CSS are ready."],
  ["Data layer", "Prisma is configured for PostgreSQL and Supabase."],
  ["Safety boundary", "The system prepares work; you always review and send."],
] as const;

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
      <section className="max-w-3xl">
        <p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">
          Project foundation
        </p>
        <h1 className="text-balance text-4xl font-semibold tracking-tight text-slate-950 sm:text-6xl">
          Your contract search, in one accountable workflow.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
          Phase 0 establishes the application and database foundation. Job tracking starts in
          Phase 1.
        </p>
      </section>

      <section aria-label="Foundation status" className="mt-14 grid gap-4 md:grid-cols-3">
        {foundations.map(([title, description]) => (
          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" key={title}>
            <h2 className="font-semibold text-slate-950">{title}</h2>
            <p className="mt-2 leading-7 text-slate-600">{description}</p>
          </article>
        ))}
      </section>

      <p className="mt-8 text-sm text-slate-600">
        Database verification: <code className="font-semibold text-slate-950">npm run db:check</code>
      </p>
    </div>
  );
}
