"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_TEASE_PRESET,
  type TeaseOverlayPreset,
} from "@/lib/tease-overlay";

async function readJson(res: Response) {
  const raw = await res.text();
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Сервер вернул не JSON (${res.status})`);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Не удалось загрузить изображение"));
    img.src = url;
  });
}

export function TeaseLabClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const photoUrlRef = useRef<string | null>(null);
  const overlayUrlRef = useRef<string | null>(null);
  const paintGen = useRef(0);

  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [overlayUrl, setOverlayUrl] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [overlayFile, setOverlayFile] = useState<File | null>(null);
  const [preset, setPreset] = useState<TeaseOverlayPreset>(DEFAULT_TEASE_PRESET);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [overlayReady, setOverlayReady] = useState(false);

  useEffect(() => {
    void fetch("/api/peach/tease-lab/preset")
      .then((r) => r.json())
      .then((d: { preset?: TeaseOverlayPreset }) => {
        if (d.preset) setPreset({ ...DEFAULT_TEASE_PRESET, ...d.preset });
      })
      .catch(() => undefined);
  }, []);

  // Revoke only on unmount (not when the other URL changes).
  useEffect(() => {
    return () => {
      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
      if (overlayUrlRef.current) URL.revokeObjectURL(overlayUrlRef.current);
    };
  }, []);

  const paint = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !photoUrl) return;
    const gen = ++paintGen.current;
    try {
      const photo = await loadImage(photoUrl);
      if (gen !== paintGen.current) return;

      const w = photo.naturalWidth;
      const h = photo.naturalHeight;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, w, h);
      ctx.filter = preset.blurPx > 0.5 ? `blur(${preset.blurPx}px)` : "none";
      ctx.drawImage(photo, 0, 0, w, h);
      ctx.filter = "none";

      if (overlayUrl) {
        const ov = await loadImage(overlayUrl);
        if (gen !== paintGen.current) return;
        const targetW = Math.max(32, Math.min(w, h) * preset.overlayScale);
        const scale = targetW / Math.max(1, ov.naturalWidth);
        const targetH = Math.max(32, ov.naturalHeight * scale);
        const x = preset.overlayX * w - targetW / 2;
        const y = preset.overlayY * h - targetH / 2;
        ctx.globalAlpha = preset.overlayOpacity;
        ctx.drawImage(ov, x, y, targetW, targetH);
        ctx.globalAlpha = 1;
        setOverlayReady(true);
      } else {
        setOverlayReady(false);
      }
      setErr("");
    } catch (e) {
      if (gen !== paintGen.current) return;
      setErr(e instanceof Error ? e.message : "ошибка превью");
    }
  }, [photoUrl, overlayUrl, preset]);

  useEffect(() => {
    void paint();
  }, [paint]);

  function onPhoto(file: File | null) {
    if (photoUrlRef.current) {
      URL.revokeObjectURL(photoUrlRef.current);
      photoUrlRef.current = null;
    }
    setPhotoFile(file);
    if (!file) {
      setPhotoUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    photoUrlRef.current = url;
    setPhotoUrl(url);
  }

  function onOverlay(file: File | null) {
    if (overlayUrlRef.current) {
      URL.revokeObjectURL(overlayUrlRef.current);
      overlayUrlRef.current = null;
    }
    setOverlayFile(file);
    setOverlayReady(false);
    if (!file) {
      setOverlayUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    overlayUrlRef.current = url;
    setOverlayUrl(url);
    setMsg(`PNG: ${file.name} (${Math.round(file.size / 1024)} КБ)`);
  }

  async function savePreset() {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const form = new FormData();
      form.set("preset", JSON.stringify(preset));
      if (overlayFile) form.set("overlay", overlayFile);
      const res = await fetch("/api/peach/tease-lab/preset", {
        method: "POST",
        body: form,
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      if (data.preset) {
        setPreset({
          ...DEFAULT_TEASE_PRESET,
          ...(data.preset as TeaseOverlayPreset),
        });
      }
      setMsg(
        overlayFile
          ? "Пресет + PNG сохранены"
          : "Пресет сохранён (PNG не выбран — загрузи файл)",
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function downloadServerPreview() {
    if (!photoFile) {
      setErr("Сначала загрузи фото");
      return;
    }
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const form = new FormData();
      form.set("photo", photoFile);
      form.set("preset", JSON.stringify(preset));
      if (overlayFile) form.set("overlay", overlayFile);
      const res = await fetch("/api/peach/tease-lab/preset", {
        method: "PUT",
        body: form,
      });
      if (!res.ok) {
        const data = await readJson(res);
        throw new Error(String(data.error || "ошибка"));
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "tease_preview_server.png";
      a.click();
      URL.revokeObjectURL(a.href);
      setMsg("Скачан server-preview (путь sharp = будущий TG)");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  function downloadCanvasPreview() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "tease_preview_canvas.png";
    a.click();
  }

  const slider = (
    label: string,
    key: "blurPx" | "overlayScale" | "overlayOpacity" | "overlayX" | "overlayY",
    min: number,
    max: number,
    step: number,
  ) => (
    <label className="flex flex-col gap-1 text-sm">
      <div className="flex justify-between text-zinc-500">
        <span>{label}</span>
        <span className="tabular-nums text-zinc-400">{preset[key]}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={preset[key]}
        onChange={(e) =>
          setPreset((p) => ({
            ...p,
            [key]: Number(e.target.value),
          }))
        }
        className="accent-peach"
      />
    </label>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[#121214] p-4">
        <label className="flex flex-col gap-2 text-sm">
          <span className="text-zinc-500">Фото (как undress-результат)</span>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => onPhoto(e.target.files?.[0] || null)}
            className="text-xs text-zinc-400"
          />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          <span className="text-zinc-500">PNG с текстом / плашкой</span>
          <input
            type="file"
            accept="image/png,image/webp,image/jpeg"
            onChange={(e) => onOverlay(e.target.files?.[0] || null)}
            className="text-xs text-zinc-400"
          />
          {overlayFile ? (
            <span className="text-xs text-peach">
              {overlayReady ? "на превью ✓" : "грузим…"} · {overlayFile.name}
            </span>
          ) : (
            <span className="text-xs text-zinc-600">файл ещё не выбран</span>
          )}
        </label>

        {slider("Blur (px)", "blurPx", 0, 60, 1)}
        {slider("Размер PNG", "overlayScale", 0.15, 1.2, 0.01)}
        {slider("Прозрачность", "overlayOpacity", 0, 1, 0.01)}
        {slider("Центр X", "overlayX", 0, 1, 0.01)}
        {slider("Центр Y", "overlayY", 0, 1, 0.01)}

        {err ? <p className="text-sm text-red-400">{err}</p> : null}
        {msg ? <p className="text-sm text-emerald-400">{msg}</p> : null}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void savePreset()}
            className="rounded-full bg-peach px-4 py-2.5 text-sm font-medium text-black disabled:opacity-50"
          >
            {busy ? "…" : "Сохранить пресет"}
          </button>
          <button
            type="button"
            disabled={!photoUrl || busy}
            onClick={downloadCanvasPreview}
            className="rounded-lg border border-white/15 px-3 py-2 text-xs hover:border-peach/40 disabled:opacity-50"
          >
            Скачать canvas-превью
          </button>
          <button
            type="button"
            disabled={!photoFile || busy}
            onClick={() => void downloadServerPreview()}
            className="rounded-lg border border-white/15 px-3 py-2 text-xs hover:border-peach/40 disabled:opacity-50"
          >
            Скачать server-превью (sharp)
          </button>
        </div>

        <p className="text-xs text-zinc-600">
          Сначала фото, потом PNG. Пресет →{" "}
          <code className="text-zinc-500">presets/tease_overlay.json</code>.
        </p>
      </div>

      <div className="overflow-auto rounded-2xl border border-white/10 bg-[#0c0c0e] p-3">
        {photoUrl ? (
          <canvas
            ref={canvasRef}
            className="mx-auto max-h-[80vh] max-w-full object-contain"
          />
        ) : (
          <p className="p-8 text-center text-sm text-zinc-600">
            Загрузи фото — превью появится здесь
          </p>
        )}
      </div>
    </div>
  );
}
