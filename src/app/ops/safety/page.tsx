"use client";

import { useCallback, useEffect, useState } from "react";
import { opsFetch } from "@/lib/ops/ops-fetch";

type AgeGateEngine = "opencv" | "insightface";

type Payload = {
  ageGateEnabled: boolean;
  engine: AgeGateEngine;
  blockBuckets: string;
  faceThresh: number;
  minScore: number;
  minAdultScore: number;
  manualUncertainModeration: boolean;
  failClosed: boolean;
  pendingCount: number;
  note: string;
};

type PendingItem = {
  id: string;
  userId: string;
  platformUserId: string;
  chatId: string;
  locale: string;
  photoUrl: string;
  createdAt: string;
  gateSummary: {
    reason: string | null;
    ageLabel: string | null;
    ageYears: number | null;
    score: number | null;
    secondLabel: string | null;
    secondScore: number | null;
    faces: number | null;
    engine: string | null;
  };
};

export default function OpsSafetyPage() {
  const [d, setD] = useState<Payload | null>(null);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [settings, queue] = await Promise.all([
      opsFetch<Payload>("/api/ops/safety"),
      opsFetch<{ pending: PendingItem[] }>("/api/ops/safety?list=pending"),
    ]);
    setD(settings);
    setPending(queue.pending || []);
  }, []);

  useEffect(() => {
    void load().catch((e) => setMsg(e instanceof Error ? e.message : "ошибка"));
  }, [load]);

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
          engine: next.engine,
          blockBuckets: next.blockBuckets,
          faceThresh: next.faceThresh,
          minScore: next.minScore,
          minAdultScore: next.minAdultScore,
          manualUncertainModeration: next.manualUncertainModeration,
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

  async function decide(id: string, action: "approve" | "reject") {
    setBusy(true);
    setMsg("");
    try {
      await opsFetch("/api/ops/safety", {
        method: "POST",
        body: JSON.stringify({ action, id }),
      });
      setMsg(action === "approve" ? "Одобрено" : "Отклонено");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "ошибка");
    } finally {
      setBusy(false);
    }
  }

  if (!d) return <p className="text-zinc-500">Загружаю…</p>;

  const engine = d.engine === "insightface" ? "insightface" : "opencv";

  return (
    <div className="flex max-w-2xl flex-col gap-5">
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

      <div className="rounded-2xl border border-white/10 bg-[#121214] p-4">
        <div className="text-sm font-medium">Модель проверки</div>
        <p className="mt-1 text-xs text-zinc-500">
          Бакеты применяются к старой модели; новая считает возраст в годах
          (&lt;13 блок, 13–18 сомнение, soft-adult до ~19.5 зависит от minAdultScore).
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void save({ engine: "opencv" })}
            className={`rounded-full px-4 py-2 text-sm ${
              engine === "opencv"
                ? "bg-sky-500/20 text-sky-200"
                : "bg-zinc-700 text-zinc-300"
            }`}
          >
            Старая (OpenCV)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save({ engine: "insightface" })}
            className={`rounded-full px-4 py-2 text-sm ${
              engine === "insightface"
                ? "bg-violet-500/20 text-violet-200"
                : "bg-zinc-700 text-zinc-300"
            }`}
          >
            Новая (InsightFace)
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-[#121214] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">
              Ручная модерация при сомнениях
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Вкл: сомнительные фото → очередь «На проверке» (без генерации).
              Выкл: сомнения = сразу блок (как несовершеннолетний). Явные детские
              бакеты всегда блокируются.
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void save({
                manualUncertainModeration: !d.manualUncertainModeration,
              })
            }
            className={`rounded-full px-4 py-2 text-sm ${
              d.manualUncertainModeration
                ? "bg-amber-500/20 text-amber-200"
                : "bg-zinc-700 text-zinc-300"
            }`}
          >
            {d.manualUncertainModeration ? "Вкл" : "Выкл"}
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
          Только для старой (OpenCV). По умолчанию: (0-2),(4-6),(8-12)
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
        Мин. уверенность для блока (дети)
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

      <div className="flex flex-col gap-1 text-sm">
        <label className="flex items-center justify-between gap-3">
          Мин. score взрослого (иначе uncertain)
          <input
            type="number"
            min={0.1}
            max={0.99}
            step={0.05}
            value={d.minAdultScore ?? 0.85}
            onChange={(e) =>
              setD({ ...d, minAdultScore: Number(e.target.value) })
            }
            className="w-28 rounded-xl border border-white/10 bg-[#121214] px-3 py-2"
          />
        </label>
        <span className="text-xs text-zinc-500">
          OpenCV: порог softmax взрослого бакета. InsightFace: soft-adult band =
          18+(1−score)×10 (при 0.85 → ~19.5y).
        </span>
      </div>

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

      <section className="mt-2">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="font-display text-xl">На проверке</h2>
          <span className="text-xs text-zinc-500">
            {pending.length || d.pendingCount || 0}
          </span>
        </div>
        {pending.length === 0 ? (
          <p className="text-sm text-zinc-500">Очередь пуста</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((item) => (
              <li
                key={item.id}
                className="flex gap-3 rounded-2xl border border-white/10 bg-[#121214] p-3"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.photoUrl}
                  alt=""
                  className="h-24 w-24 shrink-0 rounded-xl object-cover bg-zinc-800"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-xs text-zinc-400">
                    user {item.userId}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    tg {item.platformUserId} · {item.locale} ·{" "}
                    {new Date(item.createdAt).toLocaleString("ru-RU")}
                  </div>
                  <div className="mt-1 font-mono text-xs text-amber-200/90">
                    {item.gateSummary.engine
                      ? `${item.gateSummary.engine} · `
                      : ""}
                    {item.gateSummary.reason || "?"} ·{" "}
                    {item.gateSummary.ageLabel || "—"}
                    {item.gateSummary.ageYears != null
                      ? ` (${item.gateSummary.ageYears}y)`
                      : ""}{" "}
                    @ {item.gateSummary.score ?? "—"}
                    {item.gateSummary.secondLabel
                      ? ` · 2nd ${item.gateSummary.secondLabel}@${item.gateSummary.secondScore ?? "—"}`
                      : ""}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void decide(item.id, "approve")}
                      className="rounded-full bg-emerald-500/20 px-3 py-1.5 text-xs text-emerald-300 disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void decide(item.id, "reject")}
                      className="rounded-full bg-rose-500/20 px-3 py-1.5 text-xs text-rose-300 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}
    </div>
  );
}
