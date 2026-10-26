"use client";

import { roleLabel, rub } from "@/lib/cabinet/browser";

export function CabinetFrame(props: {
  name: string;
  role: string;
  balance: number;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#09090b] text-[#f4f1ec]">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-peach">
              {roleLabel(props.role)}
            </div>
            <div className="text-lg">{props.name}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-widest text-zinc-500">К выводу</div>
            <div className="text-lg">{rub(props.balance)}</div>
            <button type="button" className="text-xs text-zinc-500" onClick={props.onLogout}>
              Выйти
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">{props.children}</main>
    </div>
  );
}
