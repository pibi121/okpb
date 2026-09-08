"use client";

import { useEffect, useState } from "react";
import { fmtTime, opsFetch } from "@/lib/ops/ops-fetch";

type Payload = {
  peachesInToday: number;
  peachesInMonth: number;
  expensesMonthRub: number;
  vaultRub: number;
  stubTopups: number;
  note: string;
  expenses: Array<{
    id: string;
    title: string;
    amountRub: number;
    category: string;
    spentAt: string;
  }>;
};

export default function OpsMoneyPage() {
  const [d, setD] = useState<Payload | null>(null);
  const [msg, setMsg] = useState("");
  const [canWrite, setCanWrite] = useState(false);

  async function load() {
    const [money, me] = await Promise.all([
      opsFetch<Payload>("/api/ops/money"),
      opsFetch<{ actor: { role: string } }>("/api/ops/me"),
    ]);
    setD(money);
    setCanWrite(me.actor.role !== "partner");
  }

  useEffect(() => {
    void load().catch((e) => setMsg(e instanceof Error ? e.message : "ошибка"));
  }, []);

  if (!d) return <p className="text-zinc-500">Считаю…</p>;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl">Деньги</h1>
      <p className="rounded-2xl border border-apricot/30 bg-apricot/10 p-4 text-sm">
        {d.note}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-white/10 p-4">
          <div className="text-[11px] uppercase text-zinc-500">
            Персики сегодня
          </div>
          <div className="mt-1 text-2xl">{d.peachesInToday}</div>
        </div>
        <div className="rounded-2xl border border-white/10 p-4">
          <div className="text-[11px] uppercase text-zinc-500">
            Персики за месяц
          </div>
          <div className="mt-1 text-2xl">{d.peachesInMonth}</div>
        </div>
        <div className="rounded-2xl border border-white/10 p-4">
          <div className="text-[11px] uppercase text-zinc-500">
            Расходы за месяц, ₽
          </div>
          <div className="mt-1 text-2xl">{d.expensesMonthRub}</div>
        </div>
        <div className="rounded-2xl border border-white/10 p-4">
          <div className="text-[11px] uppercase text-zinc-500">Касса GPU, ₽</div>
          <div className="mt-1 text-2xl">{d.vaultRub}</div>
        </div>
      </div>
      <p className="text-xs text-zinc-500">
        Заглушек пополнения в журнале: {d.stubTopups}
      </p>
      {canWrite ? (
        <form
          className="grid gap-2 rounded-2xl border border-white/10 p-4 md:grid-cols-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            await opsFetch("/api/ops/money", {
              method: "POST",
              body: JSON.stringify({
                title: f.get("title"),
                amountRub: Number(f.get("amountRub")),
                category: f.get("category"),
                note: f.get("note"),
              }),
            });
            setMsg("Расход записан");
            (e.target as HTMLFormElement).reset();
            await load();
          }}
        >
          <input
            name="title"
            placeholder="На что"
            className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
            required
          />
          <input
            name="amountRub"
            type="number"
            placeholder="Сумма ₽"
            className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
            required
          />
          <select
            name="category"
            className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
          >
            <option value="gpu">Видеокарта</option>
            <option value="ads">Реклама</option>
            <option value="hosting">Хостинг</option>
            <option value="other">Прочее</option>
          </select>
          <button className="rounded-full btn-grad px-4 py-2 text-sm">
            Записать расход
          </button>
        </form>
      ) : (
        <p className="text-sm text-zinc-500">
          Просмотр статистики. Запись расходов недоступна.
        </p>
      )}
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}
      <ul className="text-sm text-zinc-400">
        {d.expenses.map((e) => (
          <li key={e.id} className="border-t border-white/8 py-2">
            {e.title} · {e.amountRub} ₽ · {e.category} · {fmtTime(e.spentAt)}
          </li>
        ))}
      </ul>
    </div>
  );
}
