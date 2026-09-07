"use client";

import { useState } from "react";
import {
  PHOTO_SCENE_CATEGORIES,
  formatPhotoSceneCategories,
  parsePhotoSceneCategories,
} from "@/lib/tg/feed-order";

type Props = {
  templateId: string;
  kind: "video" | "photo" | "lora_i2v";
  initialPublished?: boolean;
  initialDisplayTitle?: string;
  defaultTitle?: string;
  /** Comma-separated or single scene category ids (photo / lora_i2v). */
  initialSceneCategory?: string;
  onUpdated?: () => void;
};

export function TgPublishControls({
  templateId,
  kind,
  initialPublished = false,
  initialDisplayTitle = "",
  defaultTitle = "",
  initialSceneCategory = "",
  onUpdated,
}: Props) {
  const [published, setPublished] = useState(initialPublished);
  const [displayTitle, setDisplayTitle] = useState(
    initialDisplayTitle || defaultTitle,
  );
  const [categories, setCategories] = useState<string[]>(() =>
    parsePhotoSceneCategories(initialSceneCategory),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const base =
    kind === "video"
      ? `/api/peach/quick-video/templates/${templateId}/tg`
      : kind === "lora_i2v"
        ? `/api/peach/lora-i2v/templates/${templateId}/tg`
        : `/api/peach/tg-photo/templates/${templateId}/tg`;

  function toggleCategory(id: string) {
    setCategories((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function publish() {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayTitle: displayTitle.trim(),
          ...(kind === "photo" || kind === "lora_i2v"
            ? { sceneCategory: formatPhotoSceneCategories(categories) }
            : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      setPublished(true);
      setMsg("Опубликовано в Telegram");
      onUpdated?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function unpublish() {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const res = await fetch(base, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      setPublished(false);
      setMsg("Убрано из Telegram");
      onUpdated?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveMeta() {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const res = await fetch(base, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayTitle: displayTitle.trim(),
          ...(kind === "photo" || kind === "lora_i2v"
            ? { sceneCategory: formatPhotoSceneCategories(categories) }
            : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      setMsg(
        kind === "photo" || kind === "lora_i2v"
          ? "Название и категории в TG обновлены"
          : "Название в TG обновлено",
      );
      onUpdated?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="mt-2 space-y-2 rounded-lg border border-white/10 bg-[#0c0c0e] p-2.5"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        Telegram {!published ? "· ещё не видно юзерам" : "· опубликовано"}
      </div>
      <label className="block text-xs">
        <span className="text-zinc-500">Название в TG</span>
        <input
          className="mt-1 w-full rounded border border-white/10 bg-[#121214] px-2 py-1 text-xs"
          value={displayTitle}
          onChange={(e) => setDisplayTitle(e.target.value)}
          placeholder={defaultTitle}
        />
      </label>
      {kind === "photo" || kind === "lora_i2v" ? (
        <div className="space-y-1.5">
          <div className="text-[10px] text-zinc-500">
            Категории фильтра (можно несколько)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PHOTO_SCENE_CATEGORIES.map((c) => {
              const on = categories.includes(c.id);
              return (
                <label
                  key={c.id}
                  className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${
                    on
                      ? "border-peach/50 bg-peach/15 text-peach"
                      : "border-white/10 text-zinc-400"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={on}
                    onChange={() => toggleCategory(c.id)}
                  />
                  {c.ru}
                </label>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {!published ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void publish()}
            className="rounded-full bg-peach px-2.5 py-1 text-[11px] font-medium text-black disabled:opacity-50"
          >
            {busy ? "…" : "Перенести в TG"}
          </button>
        ) : (
          <>
            <span className="rounded-full border border-emerald-500/40 bg-emerald-950/40 px-2 py-0.5 text-[10px] text-emerald-300">
              В TG ✓
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void saveMeta()}
              className="rounded-full border border-white/15 px-2 py-0.5 text-[10px]"
            >
              Сохранить
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void unpublish()}
              className="rounded-full border border-red-400/30 px-2 py-0.5 text-[10px] text-red-300"
            >
              Убрать
            </button>
          </>
        )}
      </div>
      {msg ? <p className="text-[10px] text-emerald-400">{msg}</p> : null}
      {err ? <p className="text-[10px] text-red-400">{err}</p> : null}
    </div>
  );
}
