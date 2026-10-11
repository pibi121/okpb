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
  volumeBonusPeaches?: number;
  payoutDetails: string;
  partner: { code: string; user: { name: string | null } } | null;
};

export default function OpsPartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [pending, setPending] = useState<W[]>([]);
  const [draftPct, setDraftPct] = useState<Record<string, string>>({});
  const [draftBonus, setDraftBonus] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [fakeAmount, setFakeAmount] = useState("12700");
  const [fakeBonus, setFakeBonus] = useState("0");
  const [fakeBusy, setFakeBusy] = useState(false);

  async function load() {
    const d = await opsFetch<{ partners: Partner[]; pending: W[] }>(
      "/api/ops/partners",
    );
    setPartners(d.partners);
    setPending(d.pending);
    const next: Record<string, string> = {};
    const bonus: Record<string, string> = {};
    for (const p of d.partners) next[p.id] = String(p.commissionPct);
    for (const w of d.pending) bonus[w.id] = String(w.volumeBonusPeaches ?? 0);
    setDraftPct(next);
    setDraftBonus(bonus);
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

  async function approve(w: W) {
    const bonus = Math.floor(Number(draftBonus[w.id] ?? 0));
    if (!Number.isFinite(bonus) || bonus < 0) {
      setMsg("Премия за объём: число ≥ 0");
      return;
    }
    setMsg("");
    try {
      const res = await opsFetch<{
        ok: boolean;
        notify?: { ok: boolean; skipped?: boolean; error?: string };
      }>("/api/ops/partners", {
        method: "POST",
        body: JSON.stringify({
          action: "approve",
          id: w.id,
          volumeBonusPeaches: bonus,
        }),
      });
      if (res.notify?.skipped) {
        setMsg("Выплачено. Чат: PARTNERS_TG_CHAT_ID не задан — анонс пропущен");
      } else if (res.notify && !res.notify.ok) {
        setMsg(`Выплачено, но анонс в чат не ушёл: ${res.notify.error || "?"}`);
      } else {
        setMsg("Выплачено, анонс в чат партнёров отправлен");
      }
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "ошибка");
    }
  }

  async function sendFake() {
    const amount = Math.floor(Number(fakeAmount));
    const bonus = Math.floor(Number(fakeBonus || 0));
    if (!Number.isFinite(amount) || amount < 1) {
      setMsg("Фейк: сумма целое число ≥ 1");
      return;
    }
    if (!Number.isFinite(bonus) || bonus < 0) {
      setMsg("Фейк: премия ≥ 0");
      return;
    }
    setFakeBusy(true);
    setMsg("");
    try {
      const res = await opsFetch<{
        ok: boolean;
        notify?: { ok: boolean; skipped?: boolean; error?: string };
      }>("/api/ops/partners", {
        method: "POST",
        body: JSON.stringify({
          action: "fake_payout",
          amountPeaches: amount,
          volumeBonusPeaches: bonus,
        }),
      });
      if (res.notify?.skipped) {
        setMsg("Фейк записан. Чат: PARTNERS_TG_CHAT_ID не задан — анонс пропущен");
      } else if (res.notify && !res.notify.ok) {
        setMsg(`Фейк записан, анонс не ушёл: ${res.notify.error || "?"}`);
      } else {
        setMsg("Фейковая выплата отправлена в чат партнёров");
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "ошибка");
    } finally {
      setFakeBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl">Партнёры</h1>
      <p className="text-sm text-zinc-500">
        Индивидуальный % комиссии применяется к новым пополнениям рефералов,
        кабинету партнёра и тексту «Заработать» в боте. После «Выплатил» бот
        шлёт анонс в чат партнёров (нужен PARTNERS_TG_CHAT_ID).
      </p>
      {msg ? <p className="text-sm text-coral">{msg}</p> : null}

      <section className="rounded-2xl border border-white/10 p-4">
        <h2 className="text-[11px] uppercase tracking-widest text-peach">
          Фейковая выплата в чат
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          Не трогает балансы. Только пост в чат партнёров по шаблону.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            Сумма ₽
            <input
              type="number"
              min={1}
              className="mt-1 block w-32 rounded-lg border border-white/15 bg-black/30 px-2 py-1"
              value={fakeAmount}
              onChange={(e) => setFakeAmount(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Премия за объём ₽
            <input
              type="number"
              min={0}
              className="mt-1 block w-32 rounded-lg border border-white/15 bg-black/30 px-2 py-1"
              value={fakeBonus}
              onChange={(e) => setFakeBonus(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="rounded-lg bg-peach/20 px-3 py-1.5 text-sm text-peach disabled:opacity-40"
            disabled={fakeBusy}
            onClick={() => void sendFake()}
          >
            {fakeBusy ? "…" : "Отправить в чат"}
          </button>
        </div>
      </section>

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
            {w.partner?.user.name || "—"} · {w.partner?.code || "?"} ·{" "}
            {w.amountPeaches}₽
            <div className="text-zinc-500">{w.payoutDetails}</div>
            <label className="mt-2 block text-xs text-zinc-400">
              Премия за объём (в анонсе чата), ₽
              <input
                type="number"
                min={0}
                className="mt-1 block w-32 rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-sm text-white"
                value={draftBonus[w.id] ?? "0"}
                onChange={(e) =>
                  setDraftBonus((prev) => ({
                    ...prev,
                    [w.id]: e.target.value,
                  }))
                }
              />
            </label>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="text-peach"
                onClick={() => void approve(w)}
              >
                Выплатил
              </button>
              <button
                type="button"
                onClick={() =>
                  opsFetch("/api/ops/partners", {
                    method: "POST",
                    body: JSON.stringify({ action: "reject", id: w.id }),
                  })
                    .then(() => load())
                    .catch((e) =>
                      setMsg(e instanceof Error ? e.message : "ошибка"),
                    )
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
