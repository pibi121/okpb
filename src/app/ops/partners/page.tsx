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
  const [draftPct, setDraftPct] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  async function load() {
    const d = await opsFetch<{ partners: Partner[]; pending: W[] }>(
      "/api/ops/partners",
    );
    setPartners(d.partners);
    setPending(d.pending);
    const next: Record<string, string> = {};
    for (const p of d.partners) next[p.id] = String(p.commissionPct);
    setDraftPct(next);
  }

  useEffect(() => {
    void load().catch((e) => setMsg(e instanceof Error ? e.message : "ошибка"));
  }, []);

  async function saveCommission(p: Partner) {
    const raw = draftPct[p.id] ?? String(p.commissionPct);
    const pct = Math.round(Number(raw));
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      setMsg("Процент: целое число от 0 до 100");
      return;
    }
    if (pct === p.commissionPct) return;
    setSavingId(p.id);
    setMsg("");
    try {
      await opsFetch("/api/ops/partners", {
        method: "POST",
        body: JSON.stringify({
          action: "set_commission",
          id: p.id,
          commissionPct: pct,
        }),
      });
      setMsg(`@${p.code}: комиссия ${p.commissionPct}% → ${pct}%`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "ошибка сохранения");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl">Партнёры</h1>
      <p className="text-sm text-zinc-500">
        Индивидуальный % комиссии применяется к новым пополнениям рефералов,
        кабинету партнёра и тексту «Заработать» в боте.
      </p>
      {msg ? <p className="text-sm text-coral">{msg}</p> : null}
      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-peach">
          Заявки на вывод
        </h2>
        {!pending.length ? (
          <p className="mt-2 text-sm text-zinc-500">Пусто</p>
        ) : null}
        {pending.map((w) => (
          <div
            key={w.id}
            className="mt-2 rounded-2xl border border-white/10 p-4 text-sm"
          >
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
            <th className="py-2">Комиссия %</th>
            <th>Баланс</th>
            <th>Всего</th>
          </tr>
        </thead>
        <tbody>
          {partners.map((p) => {
            const dirty =
              Math.round(Number(draftPct[p.id])) !== p.commissionPct;
            return (
              <tr key={p.id} className="border-t border-white/8">
                <td className="py-2">
                  {p.user.name || "—"} · <code>{p.code}</code>
                  <div className="text-[11px] text-zinc-500">{p.user.email}</div>
                </td>
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      className="w-16 rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-sm"
                      value={draftPct[p.id] ?? String(p.commissionPct)}
                      onChange={(e) =>
                        setDraftPct((prev) => ({
                          ...prev,
                          [p.id]: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveCommission(p);
                      }}
                    />
                    <span className="text-zinc-500">%</span>
                    <button
                      type="button"
                      className="text-peach disabled:opacity-40"
                      disabled={!dirty || savingId === p.id}
                      onClick={() => void saveCommission(p)}
                    >
                      {savingId === p.id ? "…" : "Сохранить"}
                    </button>
                  </div>
                </td>
                <td>{p.balancePeaches}</td>
                <td>{p.totalEarnedPeaches}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
