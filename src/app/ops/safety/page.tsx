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
  const [zoom, setZoom] = useState<PendingItem | null>(null);

  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoom(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

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
    <div className="flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="font-display text-3xl">Безопасность</h1>
        <p className="mt-1 text-sm text-zinc-500">{d.note}</p>
      </div>

      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}

      {zoom ? (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/90 p-4"
          onClick={() => setZoom(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoom.photoUrl}
            alt=""
            className="max-h-[80vh] max-w-full rounded-xl object-contain"
          />
          <div
            className="flex items-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const id = zoom.id;
                setZoom(null);
                void decide(id, "approve");
              }}
              className="rounded-full bg-emerald-500/30 px-4 py-2 text-sm text-emerald-200 disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const id = zoom.id;
                setZoom(null);
                void decide(id, "reject");
              }}
              className="rounded-full bg-rose-500/30 px-4 py-2 text-sm text-rose-200 disabled:opacity-50"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={() => setZoom(null)}
              className="rounded-full border border-white/20 px-4 py-2 text-sm text-zinc-300"
            >
              Закрыть
            </button>
          </div>
        </div>
      ) : null}

      <section>
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
                <button
                  type="button"
                  onClick={() => setZoom(item)}
                  title="Открыть крупно"
                  className="h-40 w-40 shrink-0 cursor-zoom-in overflow-hidden rounded-xl bg-zinc-800"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.photoUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </button>
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
          Выбор применяется только после «Сохранить настройки». Бакеты — для
          старой модели; новая считает возраст в годах (&lt;13 блок, 13–18
          сомнение).
        </p>
        <div
          className="mt-3 inline-flex rounded-xl border border-white/15 bg-black/40 p-1"
          role="group"
          aria-label="Модель age-gate"
        >
          <button
            type="button"
            disabled={busy}
            onClick={() => setD({ ...d, engine: "opencv" })}
            aria-pressed={engine === "opencv"}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              engine === "opencv"
                ? "bg-white text-zinc-900 shadow"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Старая (OpenCV)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setD({ ...d, engine: "insightface" })}
            aria-pressed={engine === "insightface"}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              engine === "insightface"
                ? "bg-white text-zinc-900 shadow"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Новая (InsightFace)
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-400">
          Сейчас выбрано:{" "}
          <span className="font-medium text-zinc-100">
            {engine === "insightface"
              ? "Новая (InsightFace)"
              : "Старая (OpenCV)"}
          </span>
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-[#121214] p-4">
        <div className="text-sm font-medium">Сомнения и «Ей есть 18!»</div>
        <p className="mt-1 text-xs text-zinc-500">
          Сомнительные и детские фото блокируются сразу. Под сообщением о блоке
          у человека кнопка «Ей есть 18!» — фото попадает в очередь ниже, а в
          ops-чат (тема «Контроль качества») уходит уведомление. Одобрили —
          человеку придёт «Прости, наша ошибка…», и это же фото больше не
          блокируется (по хэшу файла). Отклонили — остаётся блок.
        </p>
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
    </div>
  );
}
