"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type ReadyVideo = { id: string; resultUrl: string };

async function readJson(res: Response) {
  const raw = await res.text();
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Сервер вернул не JSON (${res.status})`);
  }
}

export function Lab2I2vClient() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [prompt, setPrompt] = useState("");
  const [durationSec, setDurationSec] = useState(6);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [video, setVideo] = useState<ReadyVideo | null>(null);

  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function poll(id: string) {
    for (let i = 0; i < 360; i++) {
      setStatus(`Видео считается… ${i + 1}/360`);
      const res = await fetch(`/api/peach/gallery/${id}`);
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "gallery"));
      const item = (data.item || data) as {
        id: string;
        resultUrl?: string;
        status?: string;
      };
      if (item.status === "error") {
        throw new Error("Генерация упала. Подробности в галерее.");
      }
      if (
        item.status === "ready" &&
        item.resultUrl &&
        !/placeholder/i.test(item.resultUrl)
      ) {
        return { id: item.id, resultUrl: item.resultUrl };
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
    return null;
  }

  async function onGenerate() {
    if (!file) {
      setError("Выбери фото");
      return;
    }
    if (prompt.trim().length < 2) {
      setError("Напиши, что должно происходить в видео");
      return;
    }
    setBusy(true);
    setError("");
    setVideo(null);
    setStatus("Ставлю в очередь…");
    try {
      const fd = new FormData();
      fd.set("photo", file);
      fd.set("prompt", prompt.trim());
      fd.set("durationSec", String(durationSec));
      const res = await fetch("/api/peach/lab2/i2v", { method: "POST", body: fd });
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      const item = data.item as { id?: string };
      if (!item?.id) throw new Error("Нет id ролика");
      const ready = await poll(item.id);
      if (!ready) {
        throw new Error(
          "Ждали около 30 минут. Ролик может ещё считаться — открой галерею.",
        );
      }
      setVideo(ready);
      setStatus("Готово");
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
      <section className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-zinc-950/60 p-4">
        <label className="text-xs text-zinc-400">
          Фото — первый кадр
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="mt-1 block w-full text-xs text-zinc-300"
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </label>
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt=""
            className="max-h-80 w-full rounded-xl object-contain bg-black/40"
          />
        ) : (
          <p className="text-xs text-zinc-600">JPG, PNG или WEBP, до 12 МБ.</p>
        )}

        <label className="text-xs text-zinc-400">
          Что происходит в видео
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={8}
            disabled={busy}
            placeholder="Она медленно поворачивает голову и смотрит в камеру…"
            className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100"
          />
        </label>

        <label className="text-xs text-zinc-400">
          Длительность: {durationSec} с
          <input
            type="range"
            min={4}
            max={12}
            step={1}
            value={durationSec}
            disabled={busy}
            onChange={(e) => setDurationSec(Number(e.target.value))}
            className="mt-2 block w-56"
          />
        </label>

        <button
          type="button"
          disabled={busy || !file || prompt.trim().length < 2}
          onClick={() => void onGenerate()}
          className="w-fit rounded-full bg-peach px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
        >
          {busy ? "Считаю…" : "Сгенерировать"}
        </button>

        {status ? <p className="text-xs text-zinc-400">{status}</p> : null}
        {error ? <p className="text-xs text-red-400">{error}</p> : null}
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-zinc-950/60 p-4">
        <h2 className="text-sm font-medium text-zinc-200">Видео</h2>
        {video ? (
          <>
            <video
              src={video.resultUrl}
              controls
              playsInline
              className="max-h-[32rem] w-full rounded-xl bg-black object-contain"
            />
            <a
              href={video.resultUrl}
              download
              className="w-fit text-sm text-peach hover:underline"
            >
              Скачать
            </a>
          </>
        ) : (
          <p className="text-xs text-zinc-600">
            Обычно 10–25 минут. Можно уйти в{" "}
            <Link href="/peach/gallery" className="text-peach hover:underline">
              галерею
            </Link>
            : ролик появится там, даже если закрыть эту вкладку.
          </p>
        )}
      </section>
    </div>
  );
}
