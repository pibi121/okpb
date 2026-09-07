"use client";

import { useCallback, useEffect, useState } from "react";
import { TodayGenerationsStrip } from "@/components/today-generations-strip";
import { usePeachUiMode } from "@/components/peach-ui-mode-provider";
import { TgPublishControls } from "@/components/tg-publish-controls";
import { OrientationSelect } from "@/components/orientation-select";
import { PhotoEditPromptPicker } from "@/components/photo-edit-prompt-picker";
import { SKU } from "@/lib/peach-economics";
import type { VideoOrientationId } from "@/lib/video-orientation";

type Char = { id: string; name: string };

type TgTemplate = {
  id: string;
  title: string;
  notes: string;
  tier: string;
  editPrompt: string;
  previewImageUrl: string;
  tgPublished?: boolean;
  tgDisplayTitle?: string;
  sceneCategory?: string;
};

async function readJson(res: Response) {
  const raw = await res.text();
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Сервер вернул не JSON (${res.status})`);
  }
}

export function TgPhotoLabClient({ characters }: { characters: Char[] }) {
  const { isAdmin } = usePeachUiMode();
  const [templates, setTemplates] = useState<TgTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [faceFile, setFaceFile] = useState<File | null>(null);
  const [facePreview, setFacePreview] = useState<string | null>(null);
  const [characterId, setCharacterId] = useState("");
  const [faceMode, setFaceMode] = useState<"upload" | "character">("upload");
  const [orientation, setOrientation] = useState<VideoOrientationId>("9_16");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [stripRefresh, setStripRefresh] = useState(0);

  const [adminOpen, setAdminOpen] = useState(false);
  const [adminBusy, setAdminBusy] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newTier, setNewTier] = useState<"basic" | "pose">("pose");
  const [newSceneFile, setNewSceneFile] = useState<File | null>(null);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/peach/tg-photo/templates");
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      const list = (data.templates as TgTemplate[]) || [];
      setTemplates(list);
      if (!selectedId && list[0]) setSelectedId(list[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    if (!faceFile) {
      setFacePreview(null);
      return;
    }
    const url = URL.createObjectURL(faceFile);
    setFacePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [faceFile]);

  const selected = templates.find((t) => t.id === selectedId);

  async function generate() {
    setError("");
    if (!selectedId) {
      setError("Выбери шаблон");
      return;
    }
    if (faceMode === "upload" && !faceFile) {
      setError("Загрузи фото лица");
      return;
    }
    if (faceMode === "character" && !characterId) {
      setError("Выбери персонажа");
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.set("tgPhotoTemplateId", selectedId);
      form.set("orientationId", orientation);
      if (faceMode === "upload" && faceFile) {
        form.set("facePhoto", faceFile);
      } else {
        form.set("characterId", characterId);
      }
      const res = await fetch("/api/peach/tg-photo/generate", {
        method: "POST",
        body: form,
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      setStripRefresh((n) => n + 1);
      document.getElementById("today-generations")?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function createTemplate() {
    setError("");
    if (!newTitle.trim() || !newPrompt.trim() || !newSceneFile) {
      setError("Для шаблона нужны название, промпт и превью-сцены");
      return;
    }
    setAdminBusy(true);
    try {
      const form = new FormData();
      form.set("title", newTitle.trim());
      form.set("editPrompt", newPrompt.trim());
      form.set("notes", newNotes.trim());
      form.set("tier", newTier);
      form.set("scenePhoto", newSceneFile);
      const res = await fetch("/api/peach/tg-photo/templates", {
        method: "POST",
        body: form,
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      setNewTitle("");
      setNewPrompt("");
      setNewNotes("");
      setNewSceneFile(null);
      setAdminOpen(false);
      await loadTemplates();
      const tpl = data.template as TgTemplate | undefined;
      if (tpl?.id) setSelectedId(tpl.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setAdminBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="rounded-2xl border border-peach/25 bg-peach/5 p-4">
        <h2 className="font-medium text-peach">TG Face + Template (тест)</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Как в боте: <strong>1 фото лица</strong> + <strong>шаблон с превью
          позы</strong> → Krea Identity Edit (dual-ref). Без LoRA. Поза из
          превью, лицо из рефа. В мета генерации engine должен быть{" "}
          <code className="text-xs text-zinc-500">krea2_tg_face_template</code>.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[#121214] p-4">
          <h3 className="text-sm font-medium">1. Лицо модели</h3>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setFaceMode("upload")}
              className={
                faceMode === "upload"
                  ? "rounded-full border border-peach/50 bg-peach/15 px-3 py-1 text-xs text-peach"
                  : "rounded-full border border-white/15 px-3 py-1 text-xs text-zinc-400"
              }
            >
              Загрузить фото
            </button>
            <button
              type="button"
              onClick={() => setFaceMode("character")}
              className={
                faceMode === "character"
                  ? "rounded-full border border-peach/50 bg-peach/15 px-3 py-1 text-xs text-peach"
                  : "rounded-full border border-white/15 px-3 py-1 text-xs text-zinc-400"
              }
            >
              Из персонажа
            </button>
          </div>

          {faceMode === "upload" ? (
            <label className="flex flex-col gap-2 text-sm">
              <span className="text-zinc-500">
                Лучше крупное лицо, не селфи в полный рост
              </span>
              <div className="flex items-start gap-3">
                <label
                  className="flex h-24 w-24 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-white/20 bg-[#0c0c0e]"
                >
                  {facePreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={facePreview}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-xs text-zinc-600">+ фото</span>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) =>
                      setFaceFile(e.target.files?.[0] || null)
                    }
                  />
                </label>
              </div>
            </label>
          ) : (
            <label className="block text-sm">
              <span className="text-zinc-500">Персонаж (1-й реф из пака)</span>
              <select
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2 text-sm"
                value={characterId}
                onChange={(e) => setCharacterId(e.target.value)}
              >
                <option value="">— выбери —</option>
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          )}

          <label className="block text-sm">
            <span className="text-zinc-500">Ориентация</span>
            <OrientationSelect
              value={orientation}
              onChange={setOrientation}
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2 text-sm"
            />
          </label>

          {selected ? (
            <div className="rounded-lg border border-white/10 bg-[#0c0c0e] p-3 text-xs text-zinc-500">
              <div className="font-medium text-foreground">{selected.title}</div>
              <p className="mt-1 line-clamp-3">{selected.editPrompt}</p>
            </div>
          ) : null}

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <button
            type="button"
            disabled={submitting || !selectedId}
            onClick={() => void generate()}
            className="rounded-full bg-peach px-4 py-2.5 text-sm font-medium text-black disabled:opacity-50"
          >
            {submitting
              ? "В очередь…"
              : `Сгенерировать (${SKU.photo} кр.)`}
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">2. Шаблон (превью = поза)</h3>
            {isAdmin ? (
              <button
                type="button"
                className="text-xs text-peach underline"
                onClick={() => setAdminOpen((v) => !v)}
              >
                {adminOpen ? "Скрыть" : "+ Новый шаблон"}
              </button>
            ) : null}
          </div>

          {adminOpen && isAdmin ? (
            <div className="rounded-xl border border-dashed border-peach/30 bg-[#0c0c0e] p-3 space-y-2">
              <input
                className="w-full rounded-lg border border-white/10 bg-[#121214] px-3 py-2 text-sm"
                placeholder="Название"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
              <textarea
                className="w-full rounded-lg border border-white/10 bg-[#121214] px-3 py-2 text-sm min-h-[80px]"
                placeholder="Edit prompt (описание сцены для Krea)"
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
              />
              <PhotoEditPromptPicker
                value={newPrompt}
                onChange={setNewPrompt}
                hint="Позы из prompt_presets.json — подходят для TG dual-ref. Клик добавляет текст."
              />
              <input
                className="w-full rounded-lg border border-white/10 bg-[#121214] px-3 py-2 text-sm"
                placeholder="Заметки (опционально)"
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
              />
              <select
                className="w-full rounded-lg border border-white/10 bg-[#121214] px-3 py-2 text-sm"
                value={newTier}
                onChange={(e) =>
                  setNewTier(e.target.value === "pose" ? "pose" : "basic")
                }
              >
                <option value="pose">tier: pose</option>
                <option value="basic">tier: basic</option>
              </select>
              <label className="block text-xs text-zinc-500">
                Превью-сцена (готовый кадр с позой)
                <input
                  type="file"
                  accept="image/*"
                  className="mt-1 block w-full text-xs"
                  onChange={(e) =>
                    setNewSceneFile(e.target.files?.[0] || null)
                  }
                />
              </label>
              <button
                type="button"
                disabled={adminBusy}
                onClick={() => void createTemplate()}
                className="rounded-full bg-peach px-3 py-1.5 text-xs font-medium text-black disabled:opacity-50"
              >
                {adminBusy ? "Сохраняю…" : "Сохранить шаблон"}
              </button>
            </div>
          ) : null}

          {loading ? (
            <p className="text-sm text-zinc-500">Загрузка шаблонов…</p>
          ) : templates.length === 0 ? (
            <p className="text-sm text-zinc-500">
              Нет шаблонов. {isAdmin ? "Создай первый через «+ Новый шаблон»." : "Попроси админа добавить шаблоны."}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {templates.map((t) => {
                const on = t.id === selectedId;
                return (
                  <div
                    key={t.id}
                    className={
                      on
                        ? "overflow-hidden rounded-xl border-2 border-peach ring-2 ring-peach/20"
                        : "overflow-hidden rounded-xl border border-white/10 hover:border-white/25"
                    }
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedId(t.id)}
                      className="block w-full text-left"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={t.previewImageUrl}
                        alt=""
                        className="aspect-[3/4] w-full object-cover bg-[#0c0c0e]"
                      />
                      <div className="px-2 py-1.5 text-left text-xs">
                        <div className="truncate font-medium">{t.title}</div>
                        <div className="text-zinc-600">{t.tier}</div>
                      </div>
                    </button>
                    {isAdmin ? (
                      <div className="px-2 pb-2">
                        <TgPublishControls
                          templateId={t.id}
                          kind="photo"
                          initialPublished={t.tgPublished}
                          initialDisplayTitle={t.tgDisplayTitle || t.title}
                          defaultTitle={t.title}
                          initialSceneCategory={t.sceneCategory || ""}
                          onUpdated={() => void loadTemplates()}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <TodayGenerationsStrip
        kind="photo"
        editor="photo"
        refreshKey={stripRefresh}
      />
    </div>
  );
}
