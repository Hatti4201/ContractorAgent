import Image from "next/image";
import { loginAction } from "@/app/login/actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center px-6 py-16">
      <section className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <Image alt="" className="mb-5" height={40} priority src="/mark.svg" width={40} />
        <h1 className="text-2xl font-semibold text-slate-950">Sign in</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Enter the private application password to access job data.
        </p>
        <form action={loginAction} className="mt-6">
          <label className="block text-sm font-medium text-slate-800" htmlFor="password">
            Password
          </label>
          <input
            autoComplete="current-password"
            autoFocus
            className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            id="password"
            name="password"
            required
            type="password"
          />
          {error ? (
            <p className="mt-3 text-sm font-medium text-red-700" role="alert">
              Incorrect password.
            </p>
          ) : null}
          <button
            className="mt-5 w-full rounded-lg bg-slate-950 px-4 py-2.5 font-medium text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2"
            type="submit"
          >
            Sign in
          </button>
        </form>
      </section>
    </main>
  );
}
