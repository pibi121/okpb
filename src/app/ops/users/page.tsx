"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fmtTime, opsFetch } from "@/lib/ops/ops-fetch";

type Row = {
  id: string;
  name: string | null;
  email: string;
  locale: string;
  balancePeaches: number;
  blocked: boolean;
  createdAt: string;
  ageConfirmed: boolean;
  trafficLink: { code: string; label: string } | null;
  tg: { platformUserId: string; username: string | null; lastSeenAt: string } | null;
};

export default function OpsUsersPage() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState("");

  async function load(query = q) {
    try {
      const d = await opsFetch<{ rows: Row[]; total: number }>(
        `/api/ops/users?q=${encodeURIComponent(query)}`,
      );
      setRows(d.rows);
      setTotal(d.total);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ошибка");
    }
  }

  useEffect(() => {
    void load("");
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-3xl">Люди</h1>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Имя, @ник, telegram id, почта"
          className="flex-1 rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
        />
        <button className="rounded-full btn-grad px-4 py-2 text-sm">Найти</button>
      </form>
      <p className="text-xs text-zinc-500">Всего {total}</p>
      {err ? <p className="text-coral">{err}</p> : null}
      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] uppercase tracking-widest text-zinc-500">
            <tr>
              <th className="px-3 py-2">Человек</th>
              <th className="px-3 py-2">Telegram</th>
              <th className="px-3 py-2">Персики</th>
              <th className="px-3 py-2">Откуда</th>
              <th className="px-3 py-2">Зашёл</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-white/8">
                <td className="px-3 py-2">
                  <Link href={`/ops/users/${r.id}`} className="text-peach hover:underline">
                    {r.name || "без имени"}
                    {r.blocked ? " · блок" : ""}
                  </Link>
                  <div className="text-[11px] text-zinc-500">{r.locale}</div>
                </td>
                <td className="px-3 py-2 text-zinc-400">
                  {r.tg ? `@${r.tg.username || r.tg.platformUserId}` : "—"}
                </td>
                <td className="px-3 py-2">{r.balancePeaches}</td>
                <td className="px-3 py-2 text-zinc-400">{r.trafficLink?.label || "—"}</td>
                <td className="px-3 py-2 text-zinc-500">{fmtTime(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
