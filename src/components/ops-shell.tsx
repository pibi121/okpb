"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { OPS_NAV } from "@/lib/ops/nav";
import { opsFetch } from "@/lib/ops/ops-fetch";
import type { OpsSection } from "@/lib/ops/roles";

type Me = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  roleLabel: string;
  lab: boolean;
  sections: OpsSection[];
};

export function OpsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/ops";
  const router = useRouter();
  const isLogin = pathname.startsWith("/ops/login");
  const [me, setMe] = useState<Me | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (isLogin) return;
    opsFetch<{ actor: Me }>("/api/ops/me")
      .then((d) => setMe(d.actor))
      .catch(() => {
        setErr("need-login");
        router.replace("/ops/login");
      });
  }, [isLogin, router]);

  if (isLogin) return <>{children}</>;
  if (err === "need-login") return null;
  if (!me) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-zinc-500">
        Открываю панель…
      </div>
    );
  }

  const nav = OPS_NAV.filter((n) => me.sections.includes(n.section));

  return (
    <div className="flex min-h-screen bg-[#070708] text-[#f4f1ec]">
      <aside className="sticky top-0 hidden h-screen w-[220px] shrink-0 flex-col border-r border-white/8 bg-[#0c0c0e] md:flex">
        <Link href="/ops" className="px-5 pb-4 pt-6">
          <div className="font-display text-lg">
            <span className="text-grad">peach</span>
            <span className="text-zinc-500"> панель</span>
          </div>
          <p className="mt-1 text-[11px] text-zinc-500">{me.roleLabel}</p>
        </Link>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-4">
          {nav.map((n) => {
            const active =
              n.href === "/ops" ? pathname === "/ops" : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={
                  active
                    ? "rounded-xl bg-white/10 px-3 py-2 text-[13px]"
                    : "rounded-xl px-3 py-2 text-[13px] text-zinc-500 hover:bg-white/5 hover:text-foreground"
                }
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-white/8 px-4 py-4 text-[11px] text-zinc-500">
          <div className="truncate">{me.email}</div>
          {me.lab ? (
            <Link href="/peach" className="mt-2 block text-peach hover:underline">
              Лаборатория →
            </Link>
          ) : null}
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <nav className="flex gap-1 overflow-x-auto border-b border-white/8 px-3 py-2 md:hidden">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="shrink-0 rounded-full px-3 py-1.5 text-xs text-zinc-400"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</div>
      </div>
    </div>
  );
}
