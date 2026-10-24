
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  FileCheck2,
  GitCompareArrows,
  ShieldCheck,
} from "lucide-react";

const navigationItems = [
  {
    href: "/",
    label: "Overview",
    icon: Activity,
  },
  {
    href: "/regression",
    label: "Regression Lab",
    icon: GitCompareArrows,
  },
  {
    href: "/contracts",
    label: "Contracts",
    icon: FileCheck2,
  },
];

export default function WorkspaceNavigation() {
  const pathname = usePathname();

  return (
    <header className="workspace-navigation sticky top-0 z-50 border-b border-white/[0.09] bg-[#0b0f14]/95 backdrop-blur-md">
      <div className="mx-auto flex min-h-16 max-w-[1800px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="group flex min-w-0 items-center gap-3 rounded-lg"
          aria-label="SiftGuard home"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-teal-300/25 bg-teal-300/[0.08] text-teal-200">
            <ShieldCheck size={20} strokeWidth={1.8} />
          </span>

          <span className="min-w-0">
            <span className="block text-sm font-semibold tracking-[0.12em] text-white">
              SIFTGUARD
            </span>
            <span className="hidden text-[11px] text-slate-500 sm:block">
              Retrieval reliability
            </span>
          </span>
        </Link>

        <nav
          aria-label="Main navigation"
          className="flex shrink-0 items-center gap-1"
        >
          {navigationItems.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);

            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={[
                  "inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                  active
                    ? "border-teal-300/20 bg-teal-300/[0.09] font-medium text-teal-100"
                    : "border-transparent text-slate-400 hover:border-white/[0.08] hover:bg-white/[0.04] hover:text-slate-100",
                ].join(" ")}
              >
                <Icon size={16} strokeWidth={1.8} />
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-2 text-xs text-slate-500 xl:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-teal-300" />
          Developer workspace
        </div>
      </div>
    </header>
  );
}
