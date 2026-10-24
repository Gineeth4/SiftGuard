"use client";

import {
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });

      const body = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };

      if (!response.ok || !body.ok) {
        throw new Error(body.error ?? "Authentication failed.");
      }

      setPassword("");
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Authentication failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#080c14] px-5 text-slate-100">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-3xl border border-white/10 bg-[#0e1420] p-7 shadow-2xl"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-teal-300">
          SiftGuard
        </p>

        <h1 className="mt-4 text-2xl font-semibold">
          Administrator sign in
        </h1>

        <p className="mt-2 text-sm leading-6 text-slate-400">
          Sign in to inspect retrieval evaluations, contracts,
          regression reports and experiment comparisons.
        </p>

        <label
          htmlFor="password"
          className="mt-7 block text-sm font-medium text-slate-300"
        >
          Administrator password
        </label>

        <input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 outline-none focus:border-teal-300/60"
        />

        {error && (
          <p className="mt-3 rounded-lg border border-rose-400/20 bg-rose-400/5 p-3 text-sm text-rose-200">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || password.length === 0}
          className="mt-5 w-full rounded-xl bg-teal-300 px-4 py-3 font-semibold text-slate-950 transition hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>

        <p className="mt-5 text-xs leading-5 text-slate-500">
          Production login requires SIFTGUARD_ADMIN_PASSWORD and
          SIFTGUARD_SESSION_SECRET to be configured on the server.
        </p>
      </form>
    </main>
  );
}