"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TemplateCategory } from "@/lib/quick-video-template-shared";

const JUICE_PRESETS = [0, 60, 80, 100, 120, 150] as const;

export function PhotoSaveTemplateModal({
  open,
  sourceGalleryId,
  defaultTitle,
  onClose,
  onSaved,
}: {
  open: boolean;
  sourceGalleryId: string;
  defaultTitle: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(defaultTitle);
  const [notes, setNotes] = useState("");
  const [category, setCategory] = useState<TemplateCategory>("peach");
  const [isJuice, setIsJuice] = useState(false);
  const [priceCredits, setPriceCredits] = useState(80);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  async function save() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/peach/photo/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceGalleryId,
          title: title.trim() || defaultTitle,
          notes,
          category,
          isJuice,
          priceCredits: isJuice ? priceCredits : 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      onSaved?.();
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#161618] p-5 shadow-xl">
        <h3 className="text-lg font-medium">Сохранить как шаблон фото</h3>
        <p className="mt-1 text-xs text-zinc-500">
          Рецепт сцены (LEGO, ориентация, стиль) без вашего персонажа. Превью —
          этот кадр.
        </p>

        <label className="mt-4 block text-sm">
          <span className="text-zinc-400">Название</span>
          <input
            className="mt-1 w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2 text-sm"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <label className="mt-3 block text-sm">
          <span className="text-zinc-400">Описание</span>
          <textarea
            rows={2}
            className="mt-1 w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2 text-sm"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>

        <div className="mt-3">
          <div className="text-xs text-zinc-500">Категория</div>
          <div className="mt-2 flex gap-2">
            {(["peach", "bitch"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`rounded-full border px-3 py-1 text-xs capitalize ${
                  category === c
                    ? "border-peach bg-peach/15 text-peach"
                    : "border-white/15"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isJuice}
            onChange={(e) => setIsJuice(e.target.checked)}
          />
          <span>Juice (платный шаблон)</span>
        </label>

        {isJuice ? (
          <label className="mt-2 block text-sm">
            <span className="text-zinc-400">Цена разблокировки (кр.)</span>
            <select
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2 text-sm"
              value={priceCredits}
              onChange={(e) => setPriceCredits(Number(e.target.value))}
            >
              {JUICE_PRESETS.filter((p) => p > 0).map((p) => (
                <option key={p} value={p}>
                  {p} кр.
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="mt-2 text-xs text-zinc-600">Бесплатный — доступен всем.</p>
        )}

        {error ? (
          <p className="mt-3 rounded border border-red-400/30 bg-red-950/30 px-2 py-1 text-xs text-red-300">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-full border border-white/15 px-4 py-2 text-sm"
            onClick={onClose}
            disabled={busy}
          >
            Отмена
          </button>
          <button
            type="button"
            className="rounded-full bg-peach px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
            onClick={() => void save()}
            disabled={busy || !sourceGalleryId}
          >
            {busy ? "Сохраняю…" : "Сохранить"}
          </button>
        </div>
      </div>
    </div>
  );
}
