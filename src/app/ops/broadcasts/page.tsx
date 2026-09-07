"use client";

import { useEffect, useState } from "react";
import { fmtTime, opsFetch } from "@/lib/ops/ops-fetch";

type Row = {
  id: string;
  title: string;
  status: string;
  sentCount: number;
  failCount: number;
  createdAt: string;
};

export default function OpsBroadcastsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [who, setWho] = useState("all");

  async function load() {
    const d = await opsFetch<{ rows: Row[] }>("/api/ops/broadcasts");
    setRows(d.rows);
  }

  useEffect(() => {
    void load().catch((e) => setMsg(e instanceof Error ? e.message : "ошибка"));
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-3xl">Рассылки</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Сначала тест себе, потом счётчик, потом отправка. Между массовыми — пауза 30 минут. Не пишите спящим без нужды.
        </p>
      </div>
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}
      <form
        className="flex flex-col gap-2 rounded-2xl border border-white/10 p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const payload = {
            title: String(f.get("title") || ""),
            bodyRu: String(f.get("bodyRu") || ""),
            bodyEn: String(f.get("bodyEn") || ""),
            filter: { who, skipQuietDays: 7 },
          };
          const created = await opsFetch<{ id: string }>("/api/ops/broadcasts", {
            method: "POST",
            body: JSON.stringify({ action: "create", ...payload }),
          });
          if (!confirm(`Отправить ${count ?? "?"} людям?`)) return;
          await opsFetch("/api/ops/broadcasts", {
            method: "POST",
            body: JSON.stringify({ action: "send", id: created.id }),
          });
          setMsg("Рассылка пошла");
          await load();
        }}
      >
        <input name="title" placeholder="Название (для себя)" className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm" required />
        <select value={who} onChange={(e) => setWho(e.target.value)} className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm">
          <option value="all">Все, кто не в блоке</option>
          <option value="paid">Кто пополнял</option>
          <option value="never_paid">Кто не пополнял</option>
          <option value="no_job">Кто ещё не генерил</option>
        </select>
        <textarea name="bodyRu" rows={4} placeholder="Текст RU" className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm" required />
        <textarea name="bodyEn" rows={3} placeholder="Текст EN" className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm" />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-full border border-white/15 px-4 py-1.5 text-sm"
            onClick={async () => {
              const form = document.querySelector("form") as HTMLFormElement;
              const f = new FormData(form);
              await opsFetch("/api/ops/broadcasts", {
                method: "POST",
                body: JSON.stringify({
                  action: "test",
                  bodyRu: f.get("bodyRu"),
                  bodyEn: f.get("bodyEn"),
                }),
              });
              setMsg("Тест ушёл вам в бот");
            }}
          >
            Тест себе
          </button>
          <button
            type="button"
            className="rounded-full border border-white/15 px-4 py-1.5 text-sm"
            onClick={async () => {
              const d = await opsFetch<{ count: number }>("/api/ops/broadcasts", {
                method: "POST",
                body: JSON.stringify({ action: "preview", filter: { who, skipQuietDays: 7 } }),
              });
              setCount(d.count);
            }}
          >
            Сколько человек: {count ?? "?"}
          </button>
          <button className="rounded-full btn-grad px-4 py-1.5 text-sm">Отправить</button>
        </div>
      </form>
      <ul className="text-sm text-zinc-400">
        {rows.map((r) => (
          <li key={r.id} className="border-t border-white/8 py-2">
            {r.title} · {r.status} · ушло {r.sentCount} · брак {r.failCount} · {fmtTime(r.createdAt)}
          </li>
        ))}
      </ul>
    </div>
  );
}
