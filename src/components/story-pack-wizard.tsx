"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PublicStoryBeat, PublicStoryPack } from "@/lib/story-pack-types";
import { MediaLightbox } from "@/components/media-lightbox";

type Pose = { id: string; label: string };

function statusLabel(s: string) {
  switch (s) {
    case "approved":
      return "ок";
    case "rejected":
      return "плохо";
    case "pending":
      return "генерация…";
    case "ready":
      return "смотри";
    case "error":
      return "ошибка";
    case "skipped":
      return "пропуск";
    default:
      return "черновик";
  }
}

export function StoryPackWizard({
  initial,
  poses,
}: {
  initial: PublicStoryPack;
  poses: Pose[];
}) {
  const [pack, setPack] = useState(initial);
  const [beatId, setBeatId] = useState(
    initial.beats[initial.currentBeatIndex]?.id || initial.beats[0]?.id || "",
  );
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [failNote, setFailNote] = useState("");
  const [lightbox, setLightbox] = useState<{ src: string; kind: "photo" | "video" } | null>(
    null,
  );

  const beat = useMemo(
    () => pack.beats.find((b) => b.id === beatId) || pack.beats[0] || null,
    [pack, beatId],
  );

  const polling = pack.beats.some(
    (b) => b.stillStatus === "pending" || b.videoStatus === "pending",
  );

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/peach/stories/${pack.id}`);
    const data = await res.json();
    if (res.ok && data.pack) setPack(data.pack);
  }, [pack.id]);

  useEffect(() => {
    if (!polling) return;
    const t = setInterval(() => void refresh(), 2500);
    return () => clearInterval(t);
  }, [polling, refresh]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action);
    setError("");
    try {
      const res = await fetch(`/api/peach/stories/${pack.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, beatId: beat?.id, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "ошибка");
      setPack(data.pack);
      if (action === "add_beat") {
        const last = data.pack.beats[data.pack.beats.length - 1] as PublicStoryBeat | undefined;
        if (last) setBeatId(last.id);
      }
      if (action === "remove_beat") {
        const next = data.pack.beats[0] as PublicStoryBeat | undefined;
        setBeatId(next?.id || "");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy("");
    }
  }

  async function saveBeat(patch: Partial<PublicStoryBeat>) {
    if (!beat) return;
    await act("update_beat", {
      title: patch.title ?? beat.title,
      beat: patch.beat ?? beat.beat,
      never: patch.never ?? beat.never,
      isSex: patch.isSex ?? beat.isSex,
      poseId: patch.poseId === undefined ? beat.poseId : patch.poseId,
      stillPrompt: patch.stillPrompt ?? beat.stillPrompt,
      videoPrompt: patch.videoPrompt ?? beat.videoPrompt,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Link href="/peach/stories" className="text-xs text-zinc-500 underline">
            ← к сюжетам
          </Link>
          <h2 className="text-lg font-medium">{pack.title}</h2>
          <p className="text-sm text-zinc-600">
            {pack.genre && pack.genre !== "other" ? `${pack.genre} · ` : ""}
            {pack.approvedBeats}/{pack.beatCount} кадров готово
            {pack.status === "done" ? " · сюжет собран" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!!busy}
            className="rounded border px-3 py-1.5 text-sm"
            onClick={() => {
              if (confirm("Заменить текущие кадры нарезкой от LLM?")) {
                void act("suggest_beats");
              }
            }}
          >
            Перенабрать кадры (LLM)
          </button>
          <button
            type="button"
            disabled={!!busy}
            className="rounded border px-3 py-1.5 text-sm"
            onClick={() => void act("add_beat")}
          >
            + кадр
          </button>
        </div>
      </div>

      <p className="rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-700">{pack.idea}</p>
      {pack.locationNote ? (
        <p className="text-xs text-zinc-500">Локация: {pack.locationNote}</p>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <ol className="flex flex-col gap-1">
          {pack.beats.length === 0 ? (
            <li className="text-sm text-zinc-500">Нет кадров — набросай LLM или добавь вручную.</li>
          ) : (
            pack.beats.map((b, i) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => setBeatId(b.id)}
                  className={
                    b.id === beat?.id
                      ? "w-full rounded-md bg-zinc-900 px-3 py-2 text-left text-sm text-white"
                      : "w-full rounded-md border px-3 py-2 text-left text-sm"
                  }
                >
                  <div className="font-medium">
                    {i + 1}. {b.title || "кадр"}
                  </div>
                  <div className={b.id === beat?.id ? "text-xs text-zinc-300" : "text-xs text-zinc-500"}>
                    фото {statusLabel(b.stillStatus)} · видео {statusLabel(b.videoStatus)}
                  </div>
                </button>
              </li>
            ))
          )}
        </ol>

        {beat ? (
          <div className="flex flex-col gap-4 rounded-lg border bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <input
                className="flex-1 rounded border px-2 py-1.5 text-sm font-medium"
                value={beat.title}
                onChange={(e) =>
                  setPack((p) => ({
                    ...p,
                    beats: p.beats.map((x) =>
                      x.id === beat.id ? { ...x, title: e.target.value } : x,
                    ),
                  }))
                }
                onBlur={() => void saveBeat({ title: beat.title })}
              />
              <button
                type="button"
                className="text-xs text-red-600 underline"
                onClick={() => {
                  if (confirm("Удалить этот кадр?")) void act("remove_beat");
                }}
              >
                удалить
              </button>
            </div>

            <label className="flex flex-col gap-1 text-sm">
              Что на этом кадре
              <textarea
                className="rounded-md border px-2 py-1.5"
                rows={3}
                value={beat.beat}
                onChange={(e) =>
                  setPack((p) => ({
                    ...p,
                    beats: p.beats.map((x) =>
                      x.id === beat.id ? { ...x, beat: e.target.value } : x,
                    ),
                  }))
                }
                onBlur={() => void saveBeat({ beat: beat.beat })}
                placeholder="Она бежит по парковке, камера сзади, его ещё не видно"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Чего не должно быть
              <input
                className="rounded-md border px-2 py-1.5"
                value={beat.never}
                onChange={(e) =>
                  setPack((p) => ({
                    ...p,
                    beats: p.beats.map((x) =>
                      x.id === beat.id ? { ...x, never: e.target.value } : x,
                    ),
                  }))
                }
                onBlur={() => void saveBeat({ never: beat.never })}
                placeholder="секс, студия, лишние люди"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={beat.isSex}
                onChange={(e) => void saveBeat({ isSex: e.target.checked })}
              />
              Секс-кадр
            </label>
            {beat.isSex ? (
              <label className="flex flex-col gap-1 text-sm">
                Поза (геометрия)
                <select
                  className="rounded-md border px-2 py-1.5"
                  value={beat.poseId || ""}
                  onChange={(e) => void saveBeat({ poseId: e.target.value || null })}
                >
                  <option value="">—</option>
                  {poses.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <section className="border-t pt-3">
              <h3 className="text-sm font-medium">1. Фото</h3>
              <textarea
                className="mt-2 w-full rounded-md border px-2 py-1.5 font-mono text-xs"
                rows={5}
                value={beat.stillPrompt}
                onChange={(e) =>
                  setPack((p) => ({
                    ...p,
                    beats: p.beats.map((x) =>
                      x.id === beat.id ? { ...x, stillPrompt: e.target.value } : x,
                    ),
                  }))
                }
                onBlur={() => void saveBeat({ stillPrompt: beat.stillPrompt })}
                placeholder="Промпт для Krea. Можно собрать кнопкой."
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!!busy}
                  className="rounded border px-3 py-1.5 text-sm"
                  onClick={() => void act("compose_still")}
                >
                  {busy === "compose_still" ? "…" : "Собрать промпт"}
                </button>
                <button
                  type="button"
                  disabled={!!busy || beat.stillStatus === "pending"}
                  className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  onClick={() => void act("generate_still")}
                >
                  {beat.stillStatus === "pending" ? "Генерация…" : "Сгенерировать фото"}
                </button>
              </div>
              {beat.stillError ? (
                <p className="mt-2 text-sm text-red-600">{beat.stillError}</p>
              ) : null}
              {beat.stillUrl && beat.stillStatus !== "pending" ? (
                <button
                  type="button"
                  className="mt-3 overflow-hidden rounded border"
                  onClick={() => setLightbox({ src: beat.stillUrl!, kind: "photo" })}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    key={beat.stillUrl}
                    src={beat.stillUrl}
                    alt={beat.title}
                    className="max-h-[420px] w-full object-contain"
                  />
                </button>
              ) : beat.stillStatus === "pending" ? (
                <p className="mt-3 text-sm text-zinc-500">Жду кадр…</p>
              ) : null}
              {beat.stillStatus === "ready" ||
              beat.stillStatus === "rejected" ||
              beat.stillStatus === "approved" ? (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <button
                    type="button"
                    disabled={!!busy}
                    className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white"
                    onClick={() => void act("rate_still", { ok: true })}
                  >
                    Фото ок
                  </button>
                  <input
                    className="min-w-[160px] flex-1 rounded border px-2 py-1.5 text-sm"
                    placeholder="Что не так"
                    value={failNote}
                    onChange={(e) => setFailNote(e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={!!busy}
                    className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700"
                    onClick={() => {
                      void act("rate_still", { ok: false, note: failNote });
                      setFailNote("");
                    }}
                  >
                    Плохо — переделать
                  </button>
                </div>
              ) : null}
              {beat.stillFailNote ? (
                <p className="mt-1 text-xs text-red-700">Заметка: {beat.stillFailNote}</p>
              ) : null}
            </section>

            <section className="border-t pt-3">
              <h3 className="text-sm font-medium">2. Видео (когда фото ок)</h3>
              <textarea
                className="mt-2 w-full rounded-md border px-2 py-1.5 font-mono text-xs"
                rows={4}
                value={beat.videoPrompt}
                disabled={beat.stillStatus !== "approved"}
                onChange={(e) =>
                  setPack((p) => ({
                    ...p,
                    beats: p.beats.map((x) =>
                      x.id === beat.id ? { ...x, videoPrompt: e.target.value } : x,
                    ),
                  }))
                }
                onBlur={() => void saveBeat({ videoPrompt: beat.videoPrompt })}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!!busy || beat.stillStatus !== "approved"}
                  className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
                  onClick={() => void act("compose_video")}
                >
                  {busy === "compose_video" ? "…" : "Собрать motion"}
                </button>
                <button
                  type="button"
                  disabled={
                    !!busy ||
                    beat.stillStatus !== "approved" ||
                    beat.videoStatus === "pending"
                  }
                  className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  onClick={() => void act("generate_video")}
                >
                  {beat.videoStatus === "pending" ? "Генерация…" : "Оживить"}
                </button>
                <button
                  type="button"
                  disabled={!!busy || beat.stillStatus !== "approved"}
                  className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
                  onClick={() => void act("rate_video", { skip: true })}
                >
                  Пока без видео
                </button>
              </div>
              {beat.clipError ? (
                <p className="mt-2 text-sm text-red-600">{beat.clipError}</p>
              ) : null}
              {beat.clipUrl && beat.videoStatus !== "pending" ? (
                <button
                  type="button"
                  className="mt-3 overflow-hidden rounded border"
                  onClick={() => setLightbox({ src: beat.clipUrl!, kind: "video" })}
                >
                  <video
                    key={beat.clipUrl}
                    src={beat.clipUrl}
                    className="max-h-[420px] w-full"
                    muted
                    playsInline
                    controls
                  />
                </button>
              ) : null}
              {beat.videoStatus === "ready" ||
              beat.videoStatus === "rejected" ||
              beat.videoStatus === "approved" ? (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <button
                    type="button"
                    disabled={!!busy}
                    className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white"
                    onClick={() => void act("rate_video", { ok: true })}
                  >
                    Видео ок
                  </button>
                  <button
                    type="button"
                    disabled={!!busy}
                    className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700"
                    onClick={() => void act("rate_video", { ok: false, note: failNote })}
                  >
                    Плохо — переделать
                  </button>
                </div>
              ) : null}
              {beat.videoFailNote ? (
                <p className="mt-1 text-xs text-red-700">Заметка: {beat.videoFailNote}</p>
              ) : null}
            </section>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">Выбери или добавь кадр.</p>
        )}
      </div>

      {lightbox ? (
        <MediaLightbox
          src={lightbox.src}
          kind={lightbox.kind}
          onClose={() => setLightbox(null)}
        />
      ) : null}
      {busy ? <p className="text-sm text-zinc-500">{busy}…</p> : null}
    </div>
  );
}
