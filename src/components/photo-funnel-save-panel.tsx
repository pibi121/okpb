"use client";

import { useEffect, useState } from "react";
import {
  ANIMATE_DURATIONS_SEC,
  animatePromptForDuration,
  emptyPhotoAnimateConfig,
  type AnimateDurationSec,
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

type PreviewState = {
  itemId: string;
  status: "pending" | "ready" | "error";
  url?: string;
  error?: string;
  engineSec?: number;
};

type Props = {
  /** After generate — create new template from gallery item */
  mode: "create" | "edit";
  galleryItemId?: string;
  editPrompt?: string;
  initial?: FunnelPhotoTpl | null;
  onSaved?: (tpl: FunnelPhotoTpl) => void;
};

async function readJson(res: Response) {
  const raw = await res.text();
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    throw new Error(`Сервер вернул не JSON (${res.status})`);
  }
}

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
  const [previewBusySec, setPreviewBusySec] = useState<number | null>(null);
  const [previews, setPreviews] = useState<
    Partial<Record<`${AnimateDurationSec}`, PreviewState>>
  >({});

  useEffect(() => {
    if (!initial) return;
    setTitle(initial.title || "");
    setTgDisplayTitle(initial.tgDisplayTitle || initial.title || "");
    setNotes(initial.notes || "");
    setAnimate(initial.animate || emptyPhotoAnimateConfig());
    setSaved(initial);
  }, [initial]);

  const templateId = saved?.id || initial?.id || "";
  const canPreview = !!(galleryItemId || templateId);

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
        if (!templateId) throw new Error("Нет шаблона");
        form.set("templateId", templateId);
        res = await fetch("/api/peach/photo-edit/templates", {
          method: "PATCH",
          body: form,
        });
      }
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      const tpl = data.template as FunnelPhotoTpl | undefined;
      if (!tpl?.id) throw new Error("Шаблон не сохранён");
      setSaved(tpl);
      setMsg(mode === "create" ? "Шаблон создан" : "Сохранено");
      onSaved?.(tpl);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function pollVideo(
    itemId: string,
    sec: AnimateDurationSec,
  ): Promise<void> {
    const maxAttempts = 360;
    for (let i = 0; i < maxAttempts; i++) {
      setMsg(`I2V ${sec}с… ${i + 1}/${maxAttempts}`);
      const res = await fetch(`/api/peach/gallery/${itemId}`);
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "gallery"));
      const item = (data.item || data) as {
        id?: string;
        resultUrl?: string;
        status?: string;
        error?: string;
      };
      if (item.status === "error") {
        throw new Error(item.error || "I2V упал — смотри галерею");
      }
      if (
        item.status === "ready" &&
        item.resultUrl &&
        !/placeholder/i.test(item.resultUrl)
      ) {
        setPreviews((p) => ({
          ...p,
          [String(sec)]: {
            itemId,
            status: "ready",
            url: item.resultUrl,
          },
        }));
        setMsg(`Превью ${sec}с готово — смотри ролик ниже`);
        return;
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
    throw new Error(
      `Таймаут I2V ${sec}с. Видео может ещё считаться — открой Галерею.`,
    );
  }

  async function runPreview(sec: AnimateDurationSec) {
    setErr("");
    setMsg("");
    if (!canPreview) {
      setErr("Сначала сгенерируй кадр или открой сохранённый шаблон");
      return;
    }
    const prompt = animatePromptForDuration(animate, sec);
    if (prompt.length < 2) {
      setErr(
        animate.mode === "shared"
          ? "Заполни промпт оживления"
          : `Заполни промпт для ${sec} сек`,
      );
      return;
    }
    setPreviewBusySec(sec);
    setPreviews((p) => ({
      ...p,
      [String(sec)]: { itemId: "", status: "pending" },
    }));
    try {
      const res = await fetch("/api/peach/photo-edit/preview-animate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          i2vPrompt: prompt,
          durationSec: sec,
          ...(galleryItemId
            ? { stillItemId: galleryItemId }
            : { templateId }),
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      const item = data.item as { id?: string } | undefined;
      if (!item?.id) throw new Error("Нет id видео");
      const engineSec =
        typeof data.engineDurationSec === "number"
          ? data.engineDurationSec
          : sec;
      setPreviews((p) => ({
        ...p,
        [String(sec)]: {
          itemId: item.id!,
          status: "pending",
          engineSec,
        },
      }));
      setMsg(
        engineSec !== sec
          ? `I2V в очереди… (запрос ${sec}с → движок ${engineSec}с)`
          : `I2V ${sec}с в очереди GPU…`,
      );
      await pollVideo(item.id, sec);
    } catch (e) {
      const message = e instanceof Error ? e.message : "error";
      setErr(message);
      setPreviews((p) => ({
        ...p,
        [String(sec)]: {
          itemId: p[String(sec) as `${AnimateDurationSec}`]?.itemId || "",
          status: "error",
          error: message,
        },
      }));
    } finally {
      setPreviewBusySec(null);
    }
  }

  async function usePreviewAsTeaser(sec: AnimateDurationSec) {
    const prev = previews[String(sec) as `${AnimateDurationSec}`];
    if (!prev?.url || prev.status !== "ready") return;
    setErr("");
    try {
      const res = await fetch(prev.url);
      if (!res.ok) throw new Error("Не скачать видео");
      const blob = await res.blob();
      const file = new File([blob], `animate-preview-${sec}s.mp4`, {
        type: blob.type || "video/mp4",
      });
      setTeaser(file);
      setMsg(`Тизер из превью ${sec}с — нажми «Сохранить», чтобы зашить в шаблон`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    }
  }

  function renderPreviewControls(sec: AnimateDurationSec) {
    const prev = previews[String(sec) as `${AnimateDurationSec}`];
    const running = previewBusySec === sec;
    return (
      <div className="mt-2 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!!previewBusySec || !canPreview}
            onClick={() => void runPreview(sec)}
            className="rounded-full border border-peach/40 px-3 py-1 text-[11px] text-peach disabled:opacity-40"
          >
            {running ? "…" : `Превью I2V ${sec}с`}
          </button>
          {prev?.status === "pending" && prev.itemId ? (
            <span className="text-[11px] text-zinc-500">в очереди…</span>
          ) : null}
          {prev?.status === "error" ? (
            <span className="text-[11px] text-red-400">{prev.error}</span>
          ) : null}
        </div>
        {prev?.status === "ready" && prev.url ? (
          <div className="flex flex-col gap-1.5">
            <video
              src={prev.url}
              controls
              playsInline
              className="max-h-56 w-fit rounded-lg border border-white/10"
            />
            <button
              type="button"
              className="w-fit rounded-lg border border-white/15 px-2.5 py-1 text-[11px] text-zinc-300 hover:border-peach/40"
              onClick={() => void usePreviewAsTeaser(sec)}
            >
              Взять это видео как тизер шаблона
            </button>
          </div>
        ) : null}
      </div>
    );
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
        {teaser ? (
          <span className="mt-1 block text-[11px] text-peach/90">
            новый тизер: {teaser.name}
          </span>
        ) : (saved?.previewVideoUrl || initial?.previewVideoUrl) ? (
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
          <p className="text-[11px] text-zinc-500">
            Прогони I2V по промпту на кадре шаблона. Если ролик ок — сохрани
            промпты кнопкой ниже. Движок MiniMax: минимум 4 сек (запрос 3с →
            ~4с).
          </p>
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
            <div>
              <textarea
                className="min-h-[80px] w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2 text-sm"
                placeholder="Промпт оживления (I2V / motion)…"
                value={animate.sharedPrompt}
                onChange={(e) =>
                  setAnimate((a) => ({ ...a, sharedPrompt: e.target.value }))
                }
              />
              <div className="mt-2 flex flex-col gap-3">
                {ANIMATE_DURATIONS_SEC.map((sec) => (
                  <div key={sec}>{renderPreviewControls(sec)}</div>
                ))}
              </div>
            </div>
          ) : (
            ANIMATE_DURATIONS_SEC.map((sec) => (
              <label key={sec} className="text-xs text-zinc-500">
                {sec} сек
                <textarea
                  className="mt-1 min-h-[56px] w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2 text-sm text-foreground"
                  value={
                    animate.byDuration[String(sec) as `${AnimateDurationSec}`] ||
                    ""
                  }
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
                <div>{renderPreviewControls(sec)}</div>
              </label>
            ))
          )}
          {!canPreview ? (
            <p className="text-[11px] text-amber-400/90">
              Превью станет доступно после генерации кадра или выбора
              сохранённого шаблона.
            </p>
          ) : null}
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
