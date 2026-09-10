"use client";

import { useEffect, useState } from "react";
import { opsFetch } from "@/lib/ops/ops-fetch";

type Payload = {
  ageGateEnabled: boolean;
  blockBuckets: string;
  faceThresh: number;
  minScore: number;
  failClosed: boolean;
  note: string;
};

export default function OpsSafetyPage() {
  const [d, setD] = useState<Payload | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setD(await opsFetch<Payload>("/api/ops/safety"));
  }

  useEffect(() => {
    void load().catch((e) => setMsg(e instanceof Error ? e.message : "ошибка"));
  }, []);

  async function save(patch: Partial<Payload>) {
    if (!d) return;
    setBusy(true);
    setMsg("");
    try {
      const next = { ...d, ...patch };
      await opsFetch("/api/ops/safety", {
        method: "POST",
        body: JSON.stringify({
          ageGateEnabled: next.ageGateEnabled,
          blockBuckets: next.blockBuckets,
          faceThresh: next.faceThresh,
          minScore: next.minScore,
          failClosed: next.failClosed,
        }),
      });
      setMsg("Сохранено");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "ошибка");
    } finally {
      setBusy(false);
    }
  }

  if (!d) return <p className="text-zinc-500">Загружаю…</p>;

  return (
    <div className="flex max-w-xl flex-col gap-5">
      <div>
        <h1 className="font-display text-3xl">Безопасность</h1>
        <p className="mt-1 text-sm text-zinc-500">{d.note}</p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-[#121214] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Age-gate (18+ фото)</div>
            <p className="mt-1 text-xs text-zinc-500">
              Блокирует загрузку и генерации по фото, похожим на несовершеннолетних.
              Работает локально на боте — GPU не нагружает.
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save({ ageGateEnabled: !d.ageGateEnabled })}
            className={`rounded-full px-4 py-2 text-sm ${
              d.ageGateEnabled
                ? "bg-emerald-500/20 text-emerald-300"
                : "bg-zinc-700 text-zinc-300"
            }`}
          >
            {d.ageGateEnabled ? "Вкл" : "Выкл"}
          </button>
        </div>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        Блокируемые возрастные бакеты
        <input
          value={d.blockBuckets}
          onChange={(e) => setD({ ...d, blockBuckets: e.target.value })}
          className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 font-mono text-xs"
        />
        <span className="text-xs text-zinc-500">
          По умолчанию: (0-2),(4-6),(8-12),(15-20) — teen только при высокой уверенности
        </span>
      </label>

      <label className="flex items-center justify-between gap-3 text-sm">
        Порог лица (0–1)
        <input
          type="number"
          min={0.1}
          max={0.99}
          step={0.05}
          value={d.faceThresh}
          onChange={(e) => setD({ ...d, faceThresh: Number(e.target.value) })}
          className="w-28 rounded-xl border border-white/10 bg-[#121214] px-3 py-2"
        />
      </label>

      <label className="flex items-center justify-between gap-3 text-sm">
        Мин. уверенность для блока
        <input
          type="number"
          min={0.1}
          max={0.99}
          step={0.05}
          value={d.minScore ?? 0.55}
          onChange={(e) => setD({ ...d, minScore: Number(e.target.value) })}
          className="w-28 rounded-xl border border-white/10 bg-[#121214] px-3 py-2"
        />
      </label>

      <label className="flex items-center justify-between gap-3 text-sm">
        Fail-closed (если чекер упал — блокировать)
        <input
          type="checkbox"
          checked={d.failClosed}
          onChange={(e) => setD({ ...d, failClosed: e.target.checked })}
        />
      </label>

      <button
        type="button"
        disabled={busy}
        onClick={() => void save({})}
        className="rounded-full btn-grad px-4 py-2 text-sm disabled:opacity-50"
      >
        Сохранить настройки
      </button>

      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}
    </div>
  );
}
