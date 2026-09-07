"use client";

import { useEffect, useState } from "react";
import { opsFetch } from "@/lib/ops/ops-fetch";

type Partner = {
  id: string;
  code: string;
  balancePeaches: number;
  totalEarnedPeaches: number;
  commissionPct: number;
  user: { name: string | null; email: string };
};
type W = {
  id: string;
  amountPeaches: number;
  payoutDetails: string;
  partner: { code: string; user: { name: string | null } };
};

export default function OpsPartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [pending, setPending] = useState<W[]>([]);
  const [msg, setMsg] = useState("");

  async function load() {
    const d = await opsFetch<{ partners: Partner[]; pending: W[] }>("/api/ops/partners");
    setPartners(d.partners);
    setPending(d.pending);
  }

  useEffect(() => {
    void load().catch((e) => setMsg(e instanceof Error ? e.message : "ошибка"));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl">Партнёры</h1>
      {msg ? <p className="text-sm text-coral">{msg}</p> : null}
      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-peach">Заявки на вывод</h2>
        {!pending.length ? <p className="mt-2 text-sm text-zinc-500">Пусто</p> : null}
        {pending.map((w) => (
          <div key={w.id} className="mt-2 rounded-2xl border border-white/10 p-4 text-sm">
            {w.partner.user.name} · {w.partner.code} · {w.amountPeaches} 🍑
            <div className="text-zinc-500">{w.payoutDetails}</div>
            <div className="mt-2 flex gap-2">
              <button
                className="text-peach"
                onClick={() =>
                  opsFetch("/api/ops/partners", {
                    method: "POST",
                    body: JSON.stringify({ action: "approve", id: w.id }),
                  }).then(() => load())
                }
              >
                Выплатил
              </button>
              <button
                onClick={() =>
                  opsFetch("/api/ops/partners", {
                    method: "POST",
                    body: JSON.stringify({ action: "reject", id: w.id }),
                  }).then(() => load())
                }
              >
                Отклонить
              </button>
            </div>
          </div>
        ))}
      </section>
      <table className="w-full text-left text-sm">
        <thead className="text-[11px] uppercase tracking-widest text-zinc-500">
          <tr>
            <th className="py-2">Партнёр</th>
            <th>%</th>
            <th>Баланс</th>
            <th>Всего</th>
          </tr>
        </thead>
        <tbody>
          {partners.map((p) => (
            <tr key={p.id} className="border-t border-white/8">
              <td className="py-2">
                {p.user.name} · {p.code}
              </td>
              <td>{p.commissionPct}</td>
              <td>{p.balancePeaches}</td>
              <td>{p.totalEarnedPeaches}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
