"use client";

import { useEffect, useState } from "react";
import { opsFetch } from "@/lib/ops/ops-fetch";

type Row = {
  id: string;
  code: string;
  label: string;
  note: string;
  clicks: number;
  signups: number;
  purchases: number;
  purchasePeaches: number;
  url: string;
};

export default function OpsLinksPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState("");

  async function load() {
    const d = await opsFetch<{ rows: Row[] }>("/api/ops/links");
    setRows(d.rows);
  }

  useEffect(() => {
    void load().catch((e) => setMsg(e instanceof Error ? e.message : "ошибка"));
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-3xl">Свои ссылки</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Метки для рекламы и каналов (как UTM): человек заходит по{" "}
          <code className="text-zinc-300">?start=m_код</code>. По каждой ссылке
          видны клики, заходы и оплаты.
        </p>
      </div>
      <form
        className="grid gap-2 rounded-2xl border border-white/10 p-4 md:grid-cols-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            const d = await opsFetch<{ url: string }>("/api/ops/links", {
              method: "POST",
              body: JSON.stringify({
                code: f.get("code"),
                label: f.get("label"),
                note: f.get("note"),
              }),
            });
            setMsg(`Готово: ${d.url}`);
            (e.target as HTMLFormElement).reset();
            await load();
          } catch (err) {
            setMsg(err instanceof Error ? err.message : "ошибка");
          }
        }}
      >
        <input name="code" placeholder="код / utm: yt_march" className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm" />
        <input name="label" placeholder="Название: YouTube ролик 1" className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm" />
        <input name="note" placeholder="utm_source=youtube utm_campaign=…" className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm" />
        <button className="rounded-full btn-grad px-4 py-2 text-sm md:col-span-3">Создать ссылку</button>
      </form>
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}
      <table className="w-full text-left text-sm">
        <thead className="text-[11px] uppercase tracking-widest text-zinc-500">
          <tr>
            <th className="py-2">Ссылка</th>
            <th>Клики</th>
            <th>Зашли</th>
            <th>Оплаты</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-white/8">
              <td className="py-2">
                <div>{r.label}</div>
                <button
                  className="text-xs text-peach"
                  onClick={() => navigator.clipboard.writeText(r.url)}
                >
                  {r.url}
                </button>
              </td>
              <td>{r.clicks}</td>
              <td>{r.signups}</td>
              <td>
                {r.purchases} / {r.purchasePeaches}🍑
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
