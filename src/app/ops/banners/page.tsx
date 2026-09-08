"use client";

import { useEffect, useState } from "react";
import { fmtTime, opsFetch } from "@/lib/ops/ops-fetch";

type Row = {
  id: string;
  kind: string;
  imageUrl: string;
  href: string;
  label: string;
  sortOrder: number;
  enabled: boolean;
  createdAt: string;
};

export default function OpsBannersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState("");
  const [kind, setKind] = useState<"horizontal" | "vertical">("horizontal");

  async function load() {
    const d = await opsFetch<{ rows: Row[] }>("/api/ops/banners");
    setRows(d.rows);
  }

  useEffect(() => {
    void load().catch((e) => setMsg(e instanceof Error ? e.message : "ошибка"));
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-3xl">Баннеры Mini App</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Горизонтальные — карусель под логотипом (Галерея / Фото / Видео / Профиль). Вертикальные —
          в ленте (не в первых 3, не чаще чем раз на 6 карточек). Ссылка: путь мини-аппа или https.
        </p>
      </div>
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}

      <form
        className="flex flex-col gap-2 rounded-2xl border border-white/10 p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          f.set("kind", kind);
          try {
            const res = await fetch("/api/ops/banners", { method: "POST", body: f });
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
            setMsg("Баннер добавлен");
            form.reset();
            await load();
          } catch (err) {
            setMsg(err instanceof Error ? err.message : "ошибка");
          }
        }}
      >
        <div className="flex flex-wrap gap-2">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as "horizontal" | "vertical")}
            className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
          >
            <option value="horizontal">Горизонтальный</option>
            <option value="vertical">Вертикальный (лента)</option>
          </select>
          <input
            name="href"
            placeholder="/tg/guide или /tg/characters?section=train"
            className="min-w-[220px] flex-1 rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
          />
          <input
            name="label"
            placeholder="Подпись"
            className="w-40 rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
          />
          <input
            name="sortOrder"
            type="number"
            defaultValue={0}
            className="w-24 rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
          />
        </div>
        <input name="file" type="file" accept="image/*" required className="text-sm text-zinc-400" />
        <button className="w-fit rounded-full btn-grad px-4 py-2 text-sm">Загрузить</button>
      </form>

      <ul className="space-y-4">
        {rows.map((r) => (
          <li key={r.id} className="rounded-2xl border border-white/10 p-3">
            <div className="flex flex-wrap gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={r.imageUrl}
                alt=""
                className="h-28 w-auto max-w-[180px] rounded-lg object-cover border border-white/10"
              />
              <div className="min-w-[200px] flex-1 space-y-2 text-sm">
                <div className="text-zinc-400">
                  {r.kind} · порядок {r.sortOrder} · {r.enabled ? "вкл" : "выкл"} ·{" "}
                  {fmtTime(r.createdAt)}
                </div>
                <input
                  defaultValue={r.href}
                  className="w-full rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
                  id={`href-${r.id}`}
                />
                <input
                  defaultValue={r.label}
                  className="w-full rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
                  id={`label-${r.id}`}
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-full border border-white/15 px-3 py-1 text-xs"
                    onClick={async () => {
                      const href = (
                        document.getElementById(`href-${r.id}`) as HTMLInputElement
                      ).value;
                      const label = (
                        document.getElementById(`label-${r.id}`) as HTMLInputElement
                      ).value;
                      await opsFetch("/api/ops/banners", {
                        method: "POST",
                        body: JSON.stringify({
                          action: "update",
                          id: r.id,
                          href,
                          label,
                        }),
                      });
                      setMsg("Сохранено");
                      await load();
                    }}
                  >
                    Сохранить ссылку
                  </button>
                  <button
                    type="button"
                    className="rounded-full border border-white/15 px-3 py-1 text-xs"
                    onClick={async () => {
                      await opsFetch("/api/ops/banners", {
                        method: "POST",
                        body: JSON.stringify({
                          action: "update",
                          id: r.id,
                          enabled: !r.enabled,
                        }),
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
                      if (!confirm("Удалить баннер?")) return;
                      await opsFetch("/api/ops/banners", {
                        method: "POST",
                        body: JSON.stringify({ action: "delete", id: r.id }),
                      });
                      await load();
                    }}
                  >
                    Удалить
                  </button>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
