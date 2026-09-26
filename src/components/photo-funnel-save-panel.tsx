"use client";

import { useEffect, useState } from "react";
import {
  ANIMATE_DURATIONS_SEC,
  emptyPhotoAnimateConfig,
  type PhotoAnimateConfig,
} from "@/lib/photo-template-animate";
import { TgPublishControls } from "@/components/tg-publish-controls";

export type FunnelPhotoTpl = {
  id: string;
  title: string;
  notes: string;
  tgDisplayTitle?: string;
  tgPublished?: boolean;
  sceneCategory?: string;
  previewImageUrl?: string;
  previewVideoUrl?: string;
  animate?: PhotoAnimateConfig;
};

type Props = {
  /** After generate — create new template from gallery item */
  mode: "create" | "edit";
  galleryItemId?: string;
  editPrompt?: string;
  initial?: FunnelPhotoTpl | null;
  onSaved?: (tpl: FunnelPhotoTpl) => void;
};

export function PhotoFunnelSavePanel({
  mode,
  galleryItemId,
  editPrompt = "",
  initial,
  onSaved,
}: Props) {
  const [title, setTitle] = useState(initial?.title || "");
  const [tgDisplayTitle, setTgDisplayTitle] = useState(
    initial?.tgDisplayTitle || initial?.title || "",
  );
  const [notes, setNotes] = useState(initial?.notes || "");
  const [teaser, setTeaser] = useState<File | null>(null);
  const [animate, setAnimate] = useState<PhotoAnimateConfig>(
    initial?.animate || emptyPhotoAnimateConfig(),
  );
  const [showAnimate, setShowAnimate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [saved, setSaved] = useState<FunnelPhotoTpl | null>(initial || null);

  useEffect(() => {
    if (!initial) return;
    setTitle(initial.title || "");
    setTgDisplayTitle(initial.tgDisplayTitle || initial.title || "");
    setNotes(initial.notes || "");
    setAnimate(initial.animate || emptyPhotoAnimateConfig());
    setSaved(initial);
  }, [initial]);

  async function submit() {
    setErr("");
    setMsg("");
    if (!title.trim()) {
      setErr("Нужно название шаблона");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("title", title.trim());
      form.set("tgDisplayTitle", (tgDisplayTitle || title).trim());
      form.set("notes", notes.trim());
      form.set("animateJson", JSON.stringify(animate));
      if (teaser) form.set("teaser", teaser);

      let res: Response;
      if (mode === "create") {
        if (!galleryItemId) throw new Error("Нет кадра");
        form.set("galleryItemId", galleryItemId);
        form.set("editPrompt", editPrompt);
        res = await fetch("/api/peach/photo-edit/save-template", {
          method: "POST",
          body: form,
        });
      } else {
        if (!initial?.id && !saved?.id) throw new Error("Нет шаблона");
        form.set("templateId", (saved?.id || initial?.id)!);
        res = await fetch("/api/peach/photo-edit/templates", {
          method: "PATCH",
          body: form,
        });
      }
      const raw = await res.text();
      const data = JSON.parse(raw || "{}") as {
        error?: string;
        template?: FunnelPhotoTpl;
      };
      if (!res.ok) throw new Error(data.error || "ошибка");
      if (!data.template?.id) throw new Error("Шаблон не сохранён");
      setSaved(data.template);
      setMsg(mode === "create" ? "Шаблон создан" : "Сохранено");
      onSaved?.(data.template);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#121214] p-4">
      <h3 className="text-sm font-medium">
        {mode === "create"
          ? "Сохранить в TG (воронка)"
          : "Настройки шаблона воронки"}
      </h3>
      {(saved?.previewImageUrl || initial?.previewImageUrl) && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={saved?.previewImageUrl || initial?.previewImageUrl}
          alt=""
          className="max-h-40 w-fit rounded-lg object-contain"
        />
      )}
      <label className="text-xs text-zinc-500">
        Название (внутри)
        <input
          className="mt-1 w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2 text-sm text-foreground"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="text-xs text-zinc-500">
        Название кнопки в боте
        <input
          className="mt-1 w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2 text-sm text-foreground"
          value={tgDisplayTitle}
          onChange={(e) => setTgDisplayTitle(e.target.value)}
          placeholder="Поза 1"
        />
      </label>
      <label className="text-xs text-zinc-500">
        Описание позы (confirm в боте)
        <textarea
          className="mt-1 min-h-[72px] w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2 text-sm text-foreground"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <label className="text-xs text-zinc-500">
        Видео-тизер (mp4/webm)
        <input
          type="file"
          accept="video/mp4,video/webm,video/*"
          className="mt-1 block w-full text-xs text-zinc-400"
          onChange={(e) => setTeaser(e.target.files?.[0] || null)}
        />
        {(saved?.previewVideoUrl || initial?.previewVideoUrl) && !teaser ? (
          <span className="mt-1 block text-[11px] text-emerald-500/80">
            тизер уже загружен
          </span>
        ) : null}
      </label>

      <button
        type="button"
        className="w-fit rounded-lg border border-white/15 px-3 py-1.5 text-xs hover:border-peach/40"
        onClick={() => setShowAnimate((v) => !v)}
      >
        {showAnimate ? "▾" : "▸"} Настроить промпт оживления (3 / 7 / 12 сек)
      </button>

      {showAnimate ? (
        <div className="flex flex-col gap-2 rounded-xl border border-dashed border-white/15 p-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              className={
                animate.mode === "shared"
                  ? "rounded-full bg-peach/20 px-3 py-1 text-peach"
                  : "rounded-full border border-white/15 px-3 py-1 text-zinc-400"
              }
              onClick={() => setAnimate((a) => ({ ...a, mode: "shared" }))}
            >
              Один промпт на все тайминги
            </button>
            <button
              type="button"
              className={
                animate.mode === "per_duration"
                  ? "rounded-full bg-peach/20 px-3 py-1 text-peach"
                  : "rounded-full border border-white/15 px-3 py-1 text-zinc-400"
              }
              onClick={() =>
                setAnimate((a) => ({ ...a, mode: "per_duration" }))
              }
            >
              Отдельный на 3 / 7 / 12
            </button>
          </div>
          {animate.mode === "shared" ? (
            <textarea
              className="min-h-[80px] w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2 text-sm"
              placeholder="Промпт оживления (I2V / motion)…"
              value={animate.sharedPrompt}
              onChange={(e) =>
                setAnimate((a) => ({ ...a, sharedPrompt: e.target.value }))
              }
            />
          ) : (
            ANIMATE_DURATIONS_SEC.map((sec) => (
              <label key={sec} className="text-xs text-zinc-500">
                {sec} сек
                <textarea
                  className="mt-1 min-h-[56px] w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2 text-sm text-foreground"
                  value={animate.byDuration[String(sec) as "3" | "7" | "12"] || ""}
                  onChange={(e) =>
                    setAnimate((a) => ({
                      ...a,
                      byDuration: {
                        ...a.byDuration,
                        [String(sec)]: e.target.value,
                      },
                    }))
                  }
                />
              </label>
            ))
          )}
        </div>
      ) : null}

      {err ? <p className="text-sm text-red-400">{err}</p> : null}
      {msg ? <p className="text-sm text-emerald-400">{msg}</p> : null}

      <button
        type="button"
        disabled={busy}
        onClick={() => void submit()}
        className="w-fit rounded-full bg-peach px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
      >
        {busy ? "…" : mode === "create" ? "Создать шаблон" : "Сохранить"}
      </button>

      {saved?.id ? (
        <TgPublishControls
          templateId={saved.id}
          kind="photo"
          initialPublished={!!saved.tgPublished}
          initialDisplayTitle={saved.tgDisplayTitle || saved.title}
          defaultTitle={saved.title}
          initialSceneCategory={saved.sceneCategory || ""}
        />
      ) : null}
    </div>
  );
}
