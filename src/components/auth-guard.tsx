"use client";

import Link from "next/link";
import {
  usePathname,
  useRouter,
} from "next/navigation";
import {
  useEffect,
  useState,
} from "react";

function ProtectedWorkspace({
  children,
  pathname,
}: {
  children: React.ReactNode;
  pathname: string;
}) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function verifySession() {
      try {
        const response = await fetch("/api/auth/session", {
          cache: "no-store",
          signal: controller.signal,
        });

        const body = (await response.json()) as {
          authenticated?: boolean;
        };

        if (cancelled) {
          return;
        }

        if (response.ok && body.authenticated === true) {
          setAuthorized(true);
        } else {
          setAuthorized(false);
          router.replace("/login");
        }
      } catch {
        if (!cancelled) {
          setAuthorized(false);
          router.replace("/login");
        }
      }
    }

    void verifySession();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [pathname, router]);

  async function logout() {
    setLoggingOut(true);

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
      });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  if (authorized !== true) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#080c14] text-slate-200">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-teal-300 border-t-transparent" />

          <p className="mt-4 text-sm text-slate-400">
            Verifying workspace access…
          </p>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[#080c14]">
      <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#0b111c]/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3">
          <Link href="/" className="font-semibold text-white">
            SiftGuard
            <span className="ml-2 text-xs font-normal text-slate-500">
              Retrieval reliability
            </span>
          </Link>

          <nav className="flex flex-wrap items-center gap-4 text-sm text-slate-300">
            <Link className="hover:text-teal-300" href="/">
              Overview
            </Link>

            <Link
              className="hover:text-teal-300"
              href="/regression"
            >
              Regression Lab
            </Link>

            <Link
              className="hover:text-teal-300"
              href="/contracts"
            >
              Contracts
            </Link>

            <Link
              className="hover:text-teal-300"
              href="/comparison"
            >
              Comparison
            </Link>

            {process.env.NODE_ENV === "production" && (
              <button
                type="button"
                onClick={() => void logout()}
                disabled={loggingOut}
                className="rounded-lg border border-white/10 px-3 py-1.5 hover:border-rose-300/40 hover:text-rose-200 disabled:opacity-50"
              >
                {loggingOut ? "Signing out…" : "Sign out"}
              </button>
            )}
          </nav>
        </div>
      </header>

      {children}
    </div>
  );
}

export default function AuthGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  if (pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <ProtectedWorkspace key={pathname} pathname={pathname}>
      {children}
    </ProtectedWorkspace>
  );
}