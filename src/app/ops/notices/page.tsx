"use client";

import { useEffect, useState } from "react";
import { opsFetch } from "@/lib/ops/ops-fetch";

type Row = {
  slot: string;
  title: string;
  textRu: string;
  textEn: string;
  enabled: boolean;
};

export default function OpsNoticesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState("");

  async function load() {
    const d = await opsFetch<{ rows: Row[] }>("/api/ops/notices");
    setRows(d.rows);
  }

  useEffect(() => {
    void load().catch((e) => setMsg(e instanceof Error ? e.message : "ошибка"));
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-3xl">Системные уведомления</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Заготовки на сбои и нагрузку. Глобальные «всем» включаются тумблерами на странице Очередь.
        </p>
      </div>
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}
      {rows.map((r) => (
        <form
          key={r.slot}
          className="rounded-2xl border border-white/10 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void opsFetch("/api/ops/notices", {
              method: "POST",
              body: JSON.stringify({
                slot: r.slot,
                textRu: f.get("textRu"),
                textEn: f.get("textEn"),
                enabled: f.get("enabled") === "on",
              }),
            }).then(() => setMsg("Сохранено"));
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium">{r.title}</h2>
            <label className="text-xs text-zinc-500">
              <input type="checkbox" name="enabled" defaultChecked={r.enabled} className="mr-1" />
              включено
            </label>
          </div>
          <textarea name="textRu" defaultValue={r.textRu} rows={3} className="mt-2 w-full rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm" />
          <textarea name="textEn" defaultValue={r.textEn} rows={3} className="mt-2 w-full rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm" />
          <button className="mt-2 text-sm text-peach">Сохранить</button>
        </form>
      ))}
    </div>
  );
}
