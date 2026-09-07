"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { OrientationSelect } from "@/components/orientation-select";
import type { SocialOrientationId } from "@/lib/video-orientation";

type Character = { id: string; name: string };

type SocialRun = {
  id: string;
  status: string;
  kreaPhotoUrl: string;
  resultVideoUrl: string;
  error: string | null;
};

async function readJson(res: Response) {
  const raw = await res.text();
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Сервер вернул не JSON (${res.status})`);
  }
}

export function SocialTemplateUsePanel({ characters }: { characters: Character[] }) {
  return (
    <Suspense fallback={null}>
      <SocialTemplateUseInner characters={characters} />
    </Suspense>
  );
}

function SocialTemplateUseInner({ characters }: { characters: Character[] }) {
  const sp = useSearchParams();
  const templateId = sp.get("template") || "";

  const [characterId, setCharacterId] = useState(characters[0]?.id || "");
  const [clothed, setClothed] = useState(false);
  const [wardrobeNote, setWardrobeNote] = useState("");
  const [changeOrientation, setChangeOrientation] = useState(false);
  const [orientation, setOrientation] = useState<SocialOrientationId>("9_16");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activeRun, setActiveRun] = useState<SocialRun | null>(null);

  useEffect(() => {
    if (characters[0]?.id && !characterId) setCharacterId(characters[0].id);
  }, [characters, characterId]);

  const refreshRun = useCallback(async (runId: string) => {
    const res = await fetch(`/api/peach/social/runs/${runId}`);
    const data = await readJson(res);
    if (!res.ok) throw new Error(String(data.error || "ошибка"));
    setActiveRun(data.run as SocialRun);
  }, []);

  useEffect(() => {
    if (!activeRun || !["krea_busy", "video_busy"].includes(activeRun.status)) return;
    const t = setInterval(() => {
      void refreshRun(activeRun.id).catch(() => undefined);
    }, 4000);
    return () => clearInterval(t);
  }, [activeRun, refreshRun]);

  if (!templateId) return null;

  async function startRun() {
    if (!templateId || !characterId) {
      setError("Выбери персонажа");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/peach/social/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          templateId,
          characterId,
          clothed,
          wardrobeNote: clothed ? wardrobeNote.trim() : "",
          orientation: changeOrientation ? orientation : "match_photo",
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "ошибка запуска"));
      const run = data.run as SocialRun;
      setActiveRun(run);
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function approvePhoto() {
    if (!activeRun) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        `/api/peach/social/runs/${activeRun.id}?action=approve`,
        { method: "POST" },
      );
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      await refreshRun(activeRun.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-[#121214] p-4">
      <h3 className="font-medium text-foreground">Использовать шаблон</h3>
      <p className="mt-1 text-xs text-zinc-500">
        Выбери персонажа — мы подготовим кадр, ты подтвердишь и получишь видео.
      </p>

      {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-500">Персонаж</span>
          <select
            className="rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2"
            value={characterId}
            onChange={(e) => setCharacterId(e.target.value)}
          >
            {characters.length === 0 ? (
              <option value="">— создай персонажа —</option>
            ) : (
              characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))
            )}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={clothed}
            onChange={(e) => setClothed(e.target.checked)}
          />
          В одежде
        </label>
      </div>

      {clothed ? (
        <textarea
          className="mt-3 w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2 text-sm"
          rows={2}
          value={wardrobeNote}
          onChange={(e) => setWardrobeNote(e.target.value)}
          placeholder="Опиши одежду: розовый топ, чёрные трусики…"
        />
      ) : null}

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={changeOrientation}
          onChange={(e) => setChangeOrientation(e.target.checked)}
        />
        Другая ориентация кадра
      </label>
      {changeOrientation ? (
        <div className="mt-2">
          <OrientationSelect mode="social" includeMatch value={orientation} onChange={setOrientation} />
        </div>
      ) : null}

      {!activeRun ? (
        <button
          type="button"
          disabled={busy || !characterId}
          onClick={() => void startRun()}
          className="mt-4 rounded-full bg-peach px-5 py-2 text-sm font-medium text-black disabled:opacity-50"
        >
          {busy ? "Запуск…" : "Начать"}
        </button>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-sm text-zinc-400">
            Статус:{" "}
            {activeRun.status === "awaiting_photo"
              ? "Подтверди фото"
              : activeRun.status === "ready"
                ? "Готово"
                : activeRun.status === "error"
                  ? "Ошибка"
                  : "В процессе…"}
          </p>
          {activeRun.kreaPhotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={activeRun.kreaPhotoUrl}
              alt=""
              className="max-h-80 rounded-lg border border-white/10 object-contain"
            />
          ) : null}
          {activeRun.status === "awaiting_photo" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void approvePhoto()}
              className="rounded-full bg-peach px-5 py-2 text-sm font-medium text-black disabled:opacity-50"
            >
              Подтвердить и сделать видео
            </button>
          ) : null}
          {activeRun.resultVideoUrl ? (
            <video
              src={activeRun.resultVideoUrl}
              controls
              className="max-h-96 w-full rounded-lg bg-black"
            />
          ) : null}
          {activeRun.error ? (
            <p className="text-sm text-red-400">{activeRun.error}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
