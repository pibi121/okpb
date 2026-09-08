"use client";

import { useEffect, useState } from "react";
import { fmtTime, opsFetch } from "@/lib/ops/ops-fetch";

type Row = {
  id: string;
  code: string;
  amountPeaches: number;
  maxRedemptions: number;
  redeemedCount: number;
  enabled: boolean;
  note: string;
  createdAt: string;
};

export default function OpsPromosPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState("");

  async function load() {
    const d = await opsFetch<{ rows: Row[] }>("/api/ops/promos");
    setRows(d.rows);
  }

  useEffect(() => {
    void load().catch((e) => setMsg(e instanceof Error ? e.message : "ошибка"));
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-3xl">Промокоды</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Человек пишет код в бот → на баланс падают персики. Один код — один раз на юзера. Лимит — сколько всего людей могут активировать.
        </p>
      </div>
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}

      <form
        className="grid gap-2 rounded-2xl border border-white/10 p-4 md:grid-cols-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            await opsFetch("/api/ops/promos", {
              method: "POST",
              body: JSON.stringify({
                action: "create",
                code: f.get("code"),
                amountPeaches: Number(f.get("amount")),
                maxRedemptions: Number(f.get("max")),
                note: f.get("note"),
              }),
            });
            setMsg("Промокод создан");
            (e.target as HTMLFormElement).reset();
            await load();
          } catch (err) {
            setMsg(err instanceof Error ? err.message : "ошибка");
          }
        }}
      >
        <input
          name="code"
          required
          placeholder="Слово-код"
          className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
        />
        <input
          name="amount"
          type="number"
          min={1}
          required
          placeholder="Персиков"
          className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
        />
        <input
          name="max"
          type="number"
          min={1}
          required
          placeholder="Сколько человек"
          className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
        />
        <input
          name="note"
          placeholder="Заметка (для себя)"
          className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm md:col-span-3"
        />
        <button className="rounded-full btn-grad px-4 py-2 text-sm">Создать</button>
      </form>

      <ul className="space-y-2 text-sm">
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 border-t border-white/8 py-3"
          >
            <div>
              <div className="font-mono text-peach">{r.code}</div>
              <div className="text-zinc-400">
                +{r.amountPeaches} 🍑 · использовали {r.redeemedCount}/{r.maxRedemptions}
                {r.note ? ` · ${r.note}` : ""}
                {" · "}
                {r.enabled ? "вкл" : "выкл"} · {fmtTime(r.createdAt)}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-full border border-white/15 px-3 py-1 text-xs"
                onClick={async () => {
                  await opsFetch("/api/ops/promos", {
                    method: "POST",
                    body: JSON.stringify({ action: "toggle", id: r.id }),
                  });
                  await load();
                }}
              >
                {r.enabled ? "Выключить" : "Включить"}
              </button>
              <button
                type="button"
                className="rounded-full border border-rose-500/40 px-3 py-1 text-xs text-rose-300"
                onClick={async () => {
                  if (!confirm(`Удалить ${r.code}?`)) return;
                  await opsFetch("/api/ops/promos", {
                    method: "POST",
                    body: JSON.stringify({ action: "delete", id: r.id }),
                  });
                  await load();
                }}
              >
                Удалить
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
