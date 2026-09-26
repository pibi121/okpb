"use client";

import { useCallback, useEffect, useState } from "react";
import { TgPublishControls } from "@/components/tg-publish-controls";
import {
  VIDEO_FUNNEL_CATEGORIES,
  formatVideoFunnelCategories,
  parseVideoFunnelCategories,
} from "@/lib/photo-template-animate";

type StoryTpl = {
  id: string;
  title: string;
  notes: string;
  durationSec: number;
  previewVideoUrl: string;
  previewPhotoUrl: string;
  tgPublished: boolean;
  tgDisplayTitle: string;
  sceneCategory: string;
  pricePeaches: number;
};

async function readJson(res: Response) {
  const raw = await res.text();
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Не JSON (${res.status})`);
  }
}

export function StoryVideoTemplatesPanel() {
  const [templates, setTemplates] = useState<StoryTpl[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState("");
  const [title, setTitle] = useState("");
  const [tgDisplayTitle, setTgDisplayTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [cats, setCats] = useState<string[]>([]);
  const [teaser, setTeaser] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/peach/story-video/templates");
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      setTemplates((data.templates as StoryTpl[]) || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = templates.find((x) => x.id === editId);
    if (!t) return;
    setTitle(t.title);
    setTgDisplayTitle(t.tgDisplayTitle || t.title);
    setNotes(t.notes || "");
    setCats(parseVideoFunnelCategories(t.sceneCategory));
    setTeaser(null);
    setMsg("");
    setErr("");
  }, [editId, templates]);

  function toggleCat(id: string) {
    setCats((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function save() {
    if (!editId) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const form = new FormData();
      form.set("templateId", editId);
      form.set("title", title.trim());
      form.set("tgDisplayTitle", (tgDisplayTitle || title).trim());
      form.set("notes", notes.trim());
      form.set("sceneCategory", formatVideoFunnelCategories(cats));
      if (teaser) form.set("teaser", teaser);
      const res = await fetch("/api/peach/story-video/templates", {
        method: "PATCH",
        body: form,
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      setMsg("Сохранено");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  const current = templates.find((t) => t.id === editId);

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[#121214] p-4">
      <div>
        <h2 className="text-sm font-medium">Шаблоны Story H3 · для бота</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Название кнопки, описание, тизер, категории 🍓🍿💬, публикация в TG.
          В боте для теста новой воронки — только опубликованные.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">Загрузка…</p>
      ) : (
        <select
          className="w-full max-w-lg rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2 text-sm"
          value={editId}
          onChange={(e) => setEditId(e.target.value)}
        >
          <option value="">— выбрать шаблон —</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {(t.tgDisplayTitle || t.title) +
                (t.tgPublished ? " · TG on" : " · hidden")}
            </option>
          ))}
        </select>
      )}

      {current ? (
        <div className="flex flex-col gap-3">
          {(current.previewPhotoUrl || current.previewVideoUrl) && (
            <div className="flex gap-3">
              {current.previewPhotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={current.previewPhotoUrl}
                  alt=""
                  className="max-h-32 rounded-lg object-contain"
                />
              ) : null}
              {current.previewVideoUrl ? (
                <video
                  src={current.previewVideoUrl}
                  className="max-h-32 rounded-lg"
                  controls
                  muted
                />
              ) : null}
            </div>
          )}
          <label className="text-xs text-zinc-500">
            Название
            <input
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="text-xs text-zinc-500">
            Название кнопки в боте
            <input
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2 text-sm"
              value={tgDisplayTitle}
              onChange={(e) => setTgDisplayTitle(e.target.value)}
            />
          </label>
          <label className="text-xs text-zinc-500">
            Описание
            <textarea
              className="mt-1 min-h-[72px] w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2 text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <div>
            <div className="mb-1.5 text-xs text-zinc-500">Категории кнопки</div>
            <div className="flex flex-wrap gap-1.5">
              {VIDEO_FUNNEL_CATEGORIES.map((c) => {
                const on = cats.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCat(c.id)}
                    className={
                      on
                        ? "rounded-full border border-peach/50 bg-peach/15 px-3 py-1 text-xs text-peach"
                        : "rounded-full border border-white/15 px-3 py-1 text-xs text-zinc-400"
                    }
                  >
                    {c.emoji} {c.ru}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="text-xs text-zinc-500">
            Видео-тизер
            <input
              type="file"
              accept="video/*"
              className="mt-1 block w-full text-xs text-zinc-400"
              onChange={(e) => setTeaser(e.target.files?.[0] || null)}
            />
          </label>
          {err ? <p className="text-sm text-red-400">{err}</p> : null}
          {msg ? <p className="text-sm text-emerald-400">{msg}</p> : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="w-fit rounded-full bg-peach px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
          >
            {busy ? "…" : "Сохранить метаданные"}
          </button>
          <TgPublishControls
            templateId={current.id}
            kind="video"
            initialPublished={current.tgPublished}
            initialDisplayTitle={current.tgDisplayTitle || current.title}
            defaultTitle={current.title}
            initialSceneCategory={current.sceneCategory || ""}
          />
        </div>
      ) : null}
    </div>
  );
}
