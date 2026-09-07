"use client";

import { useCallback, useEffect, useState } from "react";

type Character = { id: string; name: string };

type Ref2VRun = {
  id: string;
  title: string;
  prompt: string;
  refImageUrls: string[];
  drivingVideoUrl: string;
  resultVideoUrl: string;
  width: number;
  height: number;
  durationSec: number;
  status: string;
  error: string | null;
  engine: string | null;
  createdAt: string;
};

async function readJson(res: Response) {
  const raw = await res.text();
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Сервер вернул не JSON (${res.status})`);
  }
}

export function SocialRef2VLab({ characters }: { characters: Character[] }) {
  const [runs, setRuns] = useState<Ref2VRun[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("Ref2V remake");
  const [prompt, setPrompt] = useState("");
  const [characterId, setCharacterId] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [video, setVideo] = useState<File | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/peach/social-ref2v");
    const data = await readJson(res);
    if (!res.ok) throw new Error(String(data.error || "ошибка списка"));
    setRuns((data.runs as Ref2VRun[]) || []);
  }, []);

  useEffect(() => {
    void refresh().catch((e) => setError(e instanceof Error ? e.message : "error"));
  }, [refresh]);

  useEffect(() => {
    const anyBusy = runs.some((r) => r.status === "busy");
    if (!anyBusy) return;
    const t = setInterval(() => {
      void refresh().catch(() => undefined);
    }, 4000);
    return () => clearInterval(t);
  }, [runs, refresh]);

  async function startRun() {
    if (!photos.length) {
      setError("Загрузи хотя бы одно фото внешности");
      return;
    }
    if (!video) {
      setError("Загрузи исходное видео");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("title", title.trim() || "Ref2V remake");
      form.set("prompt", prompt.trim());
      if (characterId) form.set("characterId", characterId);
      for (const p of photos.slice(0, 4)) form.append("photos", p);
      form.set("video", video);

      const res = await fetch("/api/peach/social-ref2v", {
        method: "POST",
        body: form,
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "ошибка запуска"));
      setPhotos([]);
      setVideo(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="flex flex-col gap-3 rounded-lg border border-violet-200 bg-white p-4">
        <div>
          <h3 className="font-medium text-violet-900">MiniMax Ref2V · повторить видео</h3>
          <p className="mt-1 text-xs text-zinc-500">
            Загрузи фото внешности модели (1–4) и исходное видео. MiniMax H3 Ref2V
            возьмёт лицо/тело с фото и попытается повторить движение, камеру и тайминг
            с видео (до ~12 сек).
          </p>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          Название
          <input
            className="rounded-md border px-3 py-2"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Фото внешности (1–4)
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) =>
              setPhotos(Array.from(e.target.files || []).slice(0, 4))
            }
          />
          {photos.length > 0 ? (
            <span className="text-xs text-zinc-500">
              Выбрано: {photos.map((f) => f.name).join(", ")}
            </span>
          ) : null}
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Исходное видео (движение)
          <input
            type="file"
            accept="video/*"
            onChange={(e) => setVideo(e.target.files?.[0] || null)}
          />
          {video ? (
            <span className="text-xs text-zinc-500">{video.name}</span>
          ) : null}
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Персонаж (опционально)
          <select
            className="rounded-md border px-3 py-2"
            value={characterId}
            onChange={(e) => setCharacterId(e.target.value)}
          >
            <option value="">— без привязки —</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Доп. описание (опционально)
          <textarea
            className="rounded-md border px-3 py-2"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Например: она в красном платье, камера сбоку…"
          />
        </label>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <button
          type="button"
          disabled={busy || !photos.length || !video}
          onClick={() => void startRun()}
          className="rounded-md bg-violet-700 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {busy ? "Запускаю…" : "Сгенерировать через MiniMax Ref2V"}
        </button>
      </div>

      <div className="rounded-lg border bg-white p-4">
        <h3 className="font-medium">Прогоны</h3>
        <ul className="mt-3 divide-y">
          {runs.length === 0 ? (
            <li className="py-3 text-sm text-zinc-500">Пока пусто</li>
          ) : (
            runs.map((r) => (
              <li key={r.id} className="space-y-2 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">{r.title}</div>
                    <div className="text-xs text-zinc-500">
                      {r.status}
                      {r.engine ? ` · ${r.engine}` : ""}
                      {r.durationSec ? ` · ~${r.durationSec}s` : ""}
                      {r.width && r.height ? ` · ${r.width}×${r.height}` : ""}
                    </div>
                    {r.error ? (
                      <div className="mt-1 text-xs text-red-600">{r.error}</div>
                    ) : null}
                  </div>
                  <div className="flex gap-1">
                    {r.refImageUrls[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.refImageUrls[0]}
                        alt=""
                        className="h-12 w-12 rounded object-cover"
                      />
                    ) : null}
                  </div>
                </div>
                {r.resultVideoUrl ? (
                  <video
                    src={r.resultVideoUrl}
                    controls
                    className="max-h-56 w-full rounded border bg-black"
                  />
                ) : r.status === "busy" ? (
                  <p className="text-xs text-violet-700">Генерация… обычно несколько минут</p>
                ) : null}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
