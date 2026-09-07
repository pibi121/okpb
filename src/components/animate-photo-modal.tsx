"use client";

import { useState } from "react";

export type AnimatePhotoItem = {
  id: string;
  title: string | null;
  prompt: string | null;
  resultUrl: string;
};

export function AnimatePhotoModal({
  item,
  onClose,
  onQueued,
}: {
  item: AnimatePhotoItem;
  onClose: () => void;
  onQueued: () => void;
}) {
  const [plot, setPlot] = useState("");
  const [withMusic, setWithMusic] = useState(false);
  const [durationSec, setDurationSec] = useState(6);
  const [composed, setComposed] = useState("");
  const [composing, setComposing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function previewPrompt() {
    setComposing(true);
    setError("");
    try {
      const res = await fetch("/api/peach/compose-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "video",
          stillId: item.id,
          userNote: plot,
          durationSec,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        prompt?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error || `ошибка ${res.status}`);
        return;
      }
      setComposed(data.prompt || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "сеть / сервер недоступны");
    } finally {
      setComposing(false);
    }
  }

  async function generate() {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/peach/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "animate",
          itemId: item.id,
          plot: plot.trim() || "match the still pose",
          withMusic,
          durationSec,
          composedPrompt: composed.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        item?: unknown;
      };
      if (!res.ok) {
        setError(data.error || `ошибка ${res.status}`);
        return;
      }
      onQueued();
    } catch (e) {
      setError(e instanceof Error ? e.message : "сеть / сервер недоступны");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <h2 className="text-sm font-medium">Оживить фото</h2>
          <button
            type="button"
            className="text-sm text-zinc-500"
            onClick={onClose}
          >
            Закрыть
          </button>
        </div>

        <div className="flex flex-col gap-3 overflow-y-auto p-4">
          <div className="flex max-h-64 items-center justify-center overflow-hidden rounded-lg bg-zinc-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.resultUrl}
              alt={item.title || "still"}
              className="max-h-64 max-w-full object-contain"
            />
          </div>
          <p className="text-xs text-zinc-500">
            {item.title || "Фото"} · MiniMax I2V · базовое движение берётся из позы
            пресета (если есть в meta), длительность настраивается ниже
          </p>

          <label className="flex flex-col gap-1 text-sm">
            Сцена / движение (любой язык)
            <textarea
              rows={4}
              className="rounded-md border border-zinc-300 px-3 py-2"
              value={plot}
              onChange={(e) => {
                setPlot(e.target.value);
                setComposed("");
              }}
              placeholder="Она медленно двигается, смотрит в камеру… Можно пусто — LLM придумает действие по позе на фото."
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Длительность клипа
            <select
              className="rounded-md border border-zinc-300 px-3 py-2"
              value={durationSec}
              onChange={(e) => {
                setDurationSec(Number(e.target.value));
                setComposed("");
              }}
            >
              {[4, 5, 6, 7, 8, 9, 10, 11, 12].map((s) => (
                <option key={s} value={s}>
                  {s} сек
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={withMusic}
              onChange={(e) => setWithMusic(e.target.checked)}
            />
            Музыка (ACE-Step, тихо поверх звука MiniMax)
          </label>

          {composed ? (
            <label className="flex flex-col gap-1 text-sm">
              Промпт для MiniMax (предпросмотр)
              <textarea
                rows={6}
                className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-xs"
                value={composed}
                onChange={(e) => setComposed(e.target.value)}
              />
            </label>
          ) : null}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={composing || submitting}
              onClick={() => void previewPrompt()}
              className="rounded-md border px-4 py-2 text-sm disabled:opacity-50"
            >
              {composing ? "Составляю…" : "Составить промпт"}
            </button>
            <button
              type="button"
              disabled={submitting || composing}
              onClick={() => void generate()}
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {submitting ? "В очередь…" : "Сгенерировать клип"}
            </button>
          </div>
          <p className="text-xs text-zinc-500">
            Задача уйдёт в галерею — можно закрыть окно и уйти на другую вкладку.
          </p>
        </div>
      </div>
    </div>
  );
}
