"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { TodayGenerationsStrip } from "@/components/today-generations-strip";
import { TgPublishControls } from "@/components/tg-publish-controls";
import { OrientationSelect } from "@/components/orientation-select";
import { PhotoEditPromptPicker } from "@/components/photo-edit-prompt-picker";
import {
  PHOTO_SCENE_CATEGORIES,
  formatPhotoSceneCategories,
  parsePhotoSceneCategories,
} from "@/lib/tg/feed-order";
import type { VideoOrientationId } from "@/lib/video-orientation";

type Char = {
  id: string;
  name: string;
  loraStatus: string;
  triggerWord?: string | null;
};

type Tpl = {
  id: string;
  title: string;
  notes: string;
  stillPrompt: string;
  i2vPrompt: string;
  negativePrompt: string;
  orientation: string;
  durationSec: number;
  pricePeaches: number;
  previewImageUrl: string;
  previewVideoUrl: string;
  sourceStillId: string;
  sourceVideoId: string;
  tgPublished: boolean;
  tgDisplayTitle: string;
  sceneCategory: string;
  published: boolean;
};

async function readJson(res: Response) {
  const raw = await res.text();
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Сервер вернул не JSON (${res.status})`);
  }
}

export function LoraI2vLabClient({ characters }: { characters: Char[] }) {
  const searchParams = useSearchParams();
  const presetTemplateId =
    searchParams.get("templateId") || searchParams.get("id") || "";

  const loraChars = useMemo(
    () => characters.filter((c) => c.loraStatus === "lora_ready"),
    [characters],
  );

  const [templates, setTemplates] = useState<Tpl[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [stripRefresh, setStripRefresh] = useState(0);

  const [characterId, setCharacterId] = useState(loraChars[0]?.id || "");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [stillPrompt, setStillPrompt] = useState("");
  const [i2vPrompt, setI2vPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [orientation, setOrientation] = useState<VideoOrientationId>("9_16");
  const [durationSec, setDurationSec] = useState(6);
  const [pricePeaches, setPricePeaches] = useState(180);
  const [categories, setCategories] = useState<string[]>([]);

  const [editingId, setEditingId] = useState("");
  const [stillItemId, setStillItemId] = useState("");
  const [stillUrl, setStillUrl] = useState("");
  const [videoItemId, setVideoItemId] = useState("");
  const [videoUrl, setVideoUrl] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/peach/lora-i2v/templates");
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      setTemplates((data.templates as Tpl[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!presetTemplateId || !templates.length || editingId) return;
    const hit = templates.find((t) => t.id === presetTemplateId);
    if (hit) loadIntoForm(hit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetTemplateId, templates]);

  useEffect(() => {
    if (!characterId && loraChars[0]) setCharacterId(loraChars[0].id);
  }, [characterId, loraChars]);

  async function pollItem(
    id: string,
    opts: { maxAttempts: number; intervalMs: number; label: string },
  ): Promise<{
    id: string;
    resultUrl: string;
    kind: string;
    status?: string;
  } | null> {
    const started = Date.now();
    for (let i = 0; i < opts.maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, opts.intervalMs));
      const res = await fetch(`/api/peach/gallery/${id}`);
      if (!res.ok) continue;
      const data = await readJson(res);
      const item = (data.item || data) as {
        id: string;
        resultUrl: string;
        kind: string;
        status?: string;
        error?: string | null;
        meta?: { status?: string; error?: string };
      };
      const status = item.status || item.meta?.status || "";
      if (
        status === "ready" &&
        item.resultUrl &&
        !/placeholder/i.test(item.resultUrl)
      ) {
        return item;
      }
      if (status === "error") {
        const detail =
          item.error ||
          item.meta?.error ||
          "Генерация упала (смотри галерею)";
        throw new Error(String(detail));
      }
      const elapsedMin = ((Date.now() - started) / 60_000).toFixed(1);
      setMsg(
        `${opts.label}… ${elapsedMin} мин · ${i + 1}/${opts.maxAttempts} · ${id.slice(0, 8)}`,
      );
      setStripRefresh((n) => n + 1);
    }
    return null;
  }

  async function onStill() {
    setError("");
    setMsg("");
    setBusy("still");
    try {
      const res = await fetch("/api/peach/lora-i2v/still", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterId,
          stillPrompt,
          negativePrompt: negativePrompt || undefined,
          orientationId: orientation,
          title: title || undefined,
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      const item = data.item as { id: string };
      setStillItemId(item.id);
      setStripRefresh((n) => n + 1);
      setMsg("Still в очереди GPU…");
      // Photo usually < 5 min; keep headroom for GPU queue.
      const ready = await pollItem(item.id, {
        maxAttempts: 120,
        intervalMs: 4000,
        label: "Ждём still",
      });
      if (!ready) {
        throw new Error(
          "Таймаут still (~8 мин). Смотри галерею — если pending, подожди ещё; если error — перегенерируй.",
        );
      }
      setStillUrl(ready.resultUrl);
      setMsg("Still готов — можно оживлять");
      setStripRefresh((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy("");
    }
  }

  async function onAnimate() {
    setError("");
    setMsg("");
    if (!stillItemId) {
      setError("Сначала сделай still");
      return;
    }
    if (!i2vPrompt.trim()) {
      setError("Нужен I2V-промпт (движение)");
      return;
    }
    setBusy("animate");
    try {
      const res = await fetch("/api/peach/lora-i2v/animate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stillItemId,
          i2vPrompt,
          durationSec,
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      const item = data.item as { id: string };
      setVideoItemId(item.id);
      setStripRefresh((n) => n + 1);
      setMsg("I2V в очереди GPU (обычно 10–25 мин)…");
      // MiniMax I2V comfy timeout ≈ 15–21 мин + очередь — UI must wait longer.
      const ready = await pollItem(item.id, {
        maxAttempts: 360,
        intervalMs: 5000,
        label: "Ждём I2V",
      });
      if (!ready) {
        throw new Error(
          "Таймаут I2V (~30 мин). Видео может ещё считаться — открой Галерею или нажми «Дождаться видео» с id ниже.",
        );
      }
      setVideoUrl(ready.resultUrl);
      setMsg("Видео готово — сохрани шаблон");
      setStripRefresh((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy("");
    }
  }

  async function onResumeVideoPoll() {
    if (!videoItemId) {
      setError("Нет video id — сначала запусти оживление");
      return;
    }
    setError("");
    setBusy("animate");
    try {
      setMsg("Продолжаем ждать I2V…");
      const ready = await pollItem(videoItemId, {
        maxAttempts: 360,
        intervalMs: 5000,
        label: "Ждём I2V",
      });
      if (!ready) {
        throw new Error(
          "Всё ещё нет ready. Смотри Галерею — если error, перезапусти оживление.",
        );
      }
      setVideoUrl(ready.resultUrl);
      setMsg("Видео готово — сохрани шаблон");
      setStripRefresh((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy("");
    }
  }

  async function onSave() {
    setError("");
    setMsg("");
    setBusy("save");
    try {
      const payload = {
        title: title.trim() || "LoRA I2V",
        notes,
        stillPrompt,
        i2vPrompt,
        negativePrompt,
        orientation,
        durationSec,
        pricePeaches,
        sceneCategory: formatPhotoSceneCategories(categories),
        previewImageUrl: stillUrl,
        previewVideoUrl: videoUrl,
        sourceStillId: stillItemId,
        sourceVideoId: videoItemId,
        characterId,
      };
      const res = await fetch(
        editingId
          ? `/api/peach/lora-i2v/templates/${editingId}`
          : "/api/peach/lora-i2v/templates",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      const saved = data.template as Tpl | undefined;
      if (saved?.id) setEditingId(saved.id);
      setMsg(editingId ? "Шаблон обновлён" : "Шаблон сохранён");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy("");
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Удалить шаблон?")) return;
    const res = await fetch(`/api/peach/lora-i2v/templates/${id}`, {
      method: "DELETE",
    });
    if (res.ok) await load();
  }

  function toggleCategory(id: string) {
    setCategories((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function loadIntoForm(t: Tpl) {
    setEditingId(t.id);
    setTitle(t.title);
    setNotes(t.notes);
    setStillPrompt(t.stillPrompt);
    setI2vPrompt(t.i2vPrompt);
    setNegativePrompt(t.negativePrompt);
    setOrientation(
      (t.orientation as VideoOrientationId) || "9_16",
    );
    setDurationSec(t.durationSec || 6);
    setPricePeaches(t.pricePeaches || 202);
    setCategories(parsePhotoSceneCategories(t.sceneCategory));
    setStillUrl(t.previewImageUrl);
    setVideoUrl(t.previewVideoUrl);
    setStillItemId(t.sourceStillId);
    setVideoItemId(t.sourceVideoId);
  }

  function resetForm() {
    setEditingId("");
    setTitle("");
    setNotes("");
    setStillPrompt("");
    setI2vPrompt("");
    setNegativePrompt("");
    setStillUrl("");
    setVideoUrl("");
    setStillItemId("");
    setVideoItemId("");
    setCategories([]);
    setMsg("");
    setError("");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <div className="space-y-4 rounded-xl border border-white/10 bg-[#0c0c0e] p-4">
        <div>
          <h2 className="text-sm font-medium text-zinc-200">Сборка рецепта</h2>
          <p className="mt-1 text-[11px] text-zinc-500">
            1) Still на LoRA (Krea) → 2) оживление MiniMax I2V (обычно 10–25 мин)
            → 3) сохранить шаблон → 4) в карточке справа нажать «В Telegram».
            Без шага 4 пользователь в боте/мини-аппе шаблон не увидит.
          </p>
        </div>

        {!loraChars.length ? (
          <p className="text-sm text-amber-400">
            Нет персонажей с lora_ready — обучи LoRA в Characters.
          </p>
        ) : (
          <label className="block text-xs text-zinc-500">
            Персонаж (LoRA)
            <select
              className="mt-1 w-full rounded-lg border border-white/10 bg-zinc-900 px-2 py-2 text-sm text-zinc-100"
              value={characterId}
              onChange={(e) => setCharacterId(e.target.value)}
            >
              {loraChars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.triggerWord ? ` · ${c.triggerWord}` : ""}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block text-xs text-zinc-500">
          Название шаблона
          <input
            className="mt-1 w-full rounded-lg border border-white/10 bg-zinc-900 px-2 py-2 text-sm"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Напр. снимает топ"
          />
        </label>

        <label className="block text-xs text-zinc-500">
          Заметки
          <input
            className="mt-1 w-full rounded-lg border border-white/10 bg-zinc-900 px-2 py-2 text-sm"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-xs text-zinc-500">
            Ориентация
            <div className="mt-1">
              <OrientationSelect value={orientation} onChange={setOrientation} />
            </div>
          </label>
          <label className="block text-xs text-zinc-500">
            Длительность I2V (сек)
            <input
              type="number"
              min={4}
              max={12}
              className="mt-1 w-full rounded-lg border border-white/10 bg-zinc-900 px-2 py-2 text-sm"
              value={durationSec}
              onChange={(e) => setDurationSec(Number(e.target.value) || 6)}
            />
          </label>
          <label className="block text-xs text-zinc-500">
            Цена 🍑
            <input
              type="number"
              min={0}
              className="mt-1 w-full rounded-lg border border-white/10 bg-zinc-900 px-2 py-2 text-sm"
              value={pricePeaches}
              onChange={(e) => setPricePeaches(Number(e.target.value) || 0)}
            />
          </label>
        </div>

        <div>
          <div className="mb-1 text-[10px] text-zinc-500">
            Категории фильтра TG (как у фото)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PHOTO_SCENE_CATEGORIES.map((c) => {
              const on = categories.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleCategory(c.id)}
                  className={`rounded-full border px-2 py-0.5 text-[10px] ${
                    on
                      ? "border-peach/50 bg-peach/15 text-peach"
                      : "border-white/10 text-zinc-400"
                  }`}
                >
                  {c.ru}
                </button>
              );
            })}
          </div>
        </div>

        <label className="block text-xs text-zinc-500">
          Still-промпт (Krea + LoRA)
          <textarea
            className="mt-1 min-h-[100px] w-full rounded-lg border border-white/10 bg-zinc-900 px-2 py-2 text-sm"
            value={stillPrompt}
            onChange={(e) => setStillPrompt(e.target.value)}
            placeholder="pose, camera, wardrobe, scene… (trigger подставится сам)"
          />
        </label>
        <PhotoEditPromptPicker
          value={stillPrompt}
          onChange={setStillPrompt}
          hint="Клик добавляет текст в still-промпт"
        />

        <label className="block text-xs text-zinc-500">
          Negative (опционально)
          <textarea
            className="mt-1 min-h-[56px] w-full rounded-lg border border-white/10 bg-zinc-900 px-2 py-2 text-sm"
            value={negativePrompt}
            onChange={(e) => setNegativePrompt(e.target.value)}
          />
        </label>

        <label className="block text-xs text-zinc-500">
          I2V-промпт (движение Minimax)
          <textarea
            className="mt-1 min-h-[80px] w-full rounded-lg border border-white/10 bg-zinc-900 px-2 py-2 text-sm"
            value={i2vPrompt}
            onChange={(e) => setI2vPrompt(e.target.value)}
            placeholder="…says {{s1}}…&#10;&#10;SPEECH_SLOTS:&#10;s1 | speaker=her | lang=ru | text=Мужчина"
          />
          <span className="mt-1 block text-[11px] text-zinc-600">
            Речь: плейсхолдеры {"{{s1}}"} + блок SPEECH_SLOTS (speaker/lang/text).
            Лимит символов для пользователя = длина дефолтного text (считает Peach).
          </span>
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!!busy || !characterId || !stillPrompt.trim()}
            onClick={() => void onStill()}
            className="rounded-full bg-peach px-3 py-1.5 text-xs font-medium text-black disabled:opacity-40"
          >
            {busy === "still" ? "Still…" : "1. Сгенерировать still"}
          </button>
          <button
            type="button"
            disabled={!!busy || !stillItemId || !i2vPrompt.trim()}
            onClick={() => void onAnimate()}
            className="rounded-full border border-peach/40 bg-peach/10 px-3 py-1.5 text-xs text-peach disabled:opacity-40"
          >
            {busy === "animate" ? "I2V…" : "2. Оживить (I2V)"}
          </button>
          {videoItemId && !videoUrl ? (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void onResumeVideoPoll()}
              className="rounded-full border border-amber-500/40 px-3 py-1.5 text-xs text-amber-200 disabled:opacity-40"
            >
              Дождаться видео
            </button>
          ) : null}
          <button
            type="button"
            disabled={!!busy || !stillPrompt.trim() || !i2vPrompt.trim()}
            onClick={() => void onSave()}
            className="rounded-full border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-300 disabled:opacity-40"
          >
            {busy === "save"
              ? "…"
              : editingId
                ? "3. Обновить шаблон"
                : "3. Сохранить шаблон"}
          </button>
          {editingId ? (
            <button
              type="button"
              className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-zinc-400"
              onClick={resetForm}
            >
              Новый
            </button>
          ) : null}
        </div>

        {msg ? <p className="text-xs text-emerald-400">{msg}</p> : null}
        {error ? <p className="text-xs text-red-400">{error}</p> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-white/10 bg-black/40 p-2">
            <div className="mb-1 text-[10px] uppercase text-zinc-500">Still</div>
            {stillUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={stillUrl} alt="" className="max-h-64 w-full object-contain" />
            ) : (
              <p className="text-[11px] text-zinc-600">ещё нет</p>
            )}
            {stillItemId ? (
              <p className="mt-1 truncate text-[10px] text-zinc-600">
                id: {stillItemId}
              </p>
            ) : null}
            <label className="mt-2 block text-[10px] text-zinc-500">
              Или вставь gallery id готового still
              <div className="mt-1 flex gap-1">
                <input
                  className="min-w-0 flex-1 rounded border border-white/10 bg-zinc-900 px-2 py-1 text-[11px]"
                  placeholder="cm…"
                  id="li2v-still-attach"
                />
                <button
                  type="button"
                  className="shrink-0 rounded border border-white/15 px-2 py-1 text-[10px]"
                  disabled={!!busy}
                  onClick={() => {
                    const el = document.getElementById(
                      "li2v-still-attach",
                    ) as HTMLInputElement | null;
                    const id = el?.value.trim();
                    if (!id) return;
                    void (async () => {
                      setError("");
                      setBusy("still");
                      try {
                        const res = await fetch(`/api/peach/gallery/${id}`);
                        const data = await readJson(res);
                        if (!res.ok) throw new Error(String(data.error || "нет"));
                        const item = (data.item || data) as {
                          id: string;
                          resultUrl: string;
                          kind: string;
                          status?: string;
                        };
                        if (item.kind !== "photo") {
                          throw new Error("Нужен kind=photo");
                        }
                        if (
                          item.status &&
                          item.status !== "ready"
                        ) {
                          throw new Error(`Still status: ${item.status}`);
                        }
                        if (
                          !item.resultUrl ||
                          /placeholder/i.test(item.resultUrl)
                        ) {
                          throw new Error("У кадра нет файла");
                        }
                        setStillItemId(item.id);
                        setStillUrl(item.resultUrl);
                        setMsg("Still подключён из галереи");
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "error");
                      } finally {
                        setBusy("");
                      }
                    })();
                  }}
                >
                  Взять
                </button>
              </div>
            </label>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/40 p-2">
            <div className="mb-1 text-[10px] uppercase text-zinc-500">Video</div>
            {videoUrl ? (
              <video
                src={videoUrl}
                controls
                playsInline
                className="max-h-64 w-full object-contain"
              />
            ) : (
              <p className="text-[11px] text-zinc-600">ещё нет</p>
            )}
            {videoItemId ? (
              <p className="mt-1 truncate text-[10px] text-zinc-600">
                id: {videoItemId}
              </p>
            ) : null}
            <label className="mt-2 block text-[10px] text-zinc-500">
              Или вставь gallery id готового / pending видео
              <div className="mt-1 flex gap-1">
                <input
                  className="min-w-0 flex-1 rounded border border-white/10 bg-zinc-900 px-2 py-1 text-[11px]"
                  placeholder="cm…"
                  id="li2v-video-attach"
                />
                <button
                  type="button"
                  className="shrink-0 rounded border border-white/15 px-2 py-1 text-[10px]"
                  disabled={!!busy}
                  onClick={() => {
                    const el = document.getElementById(
                      "li2v-video-attach",
                    ) as HTMLInputElement | null;
                    const id = el?.value.trim();
                    if (!id) return;
                    void (async () => {
                      setError("");
                      setBusy("animate");
                      try {
                        const res = await fetch(`/api/peach/gallery/${id}`);
                        const data = await readJson(res);
                        if (!res.ok) throw new Error(String(data.error || "нет"));
                        const item = (data.item || data) as {
                          id: string;
                          resultUrl: string;
                          kind: string;
                          status?: string;
                        };
                        if (item.kind !== "video") {
                          throw new Error("Нужен kind=video");
                        }
                        setVideoItemId(item.id);
                        if (
                          item.status === "ready" &&
                          item.resultUrl &&
                          !/placeholder/i.test(item.resultUrl)
                        ) {
                          setVideoUrl(item.resultUrl);
                          setMsg("Видео подключено из галереи");
                          return;
                        }
                        if (item.status === "error") {
                          throw new Error("Это видео в ошибке — перезапусти I2V");
                        }
                        setMsg("Видео ещё pending — жду GPU…");
                        const ready = await pollItem(item.id, {
                          maxAttempts: 360,
                          intervalMs: 5000,
                          label: "Ждём I2V",
                        });
                        if (!ready) {
                          throw new Error("Таймаут — смотри галерею");
                        }
                        setVideoUrl(ready.resultUrl);
                        setMsg("Видео готово — сохрани шаблон");
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "error");
                      } finally {
                        setBusy("");
                      }
                    })();
                  }}
                >
                  Взять
                </button>
              </div>
            </label>
          </div>
        </div>

        <TodayGenerationsStrip
          kind="photo"
          editor="photo"
          refreshKey={stripRefresh}
        />
        <TodayGenerationsStrip
          kind="video"
          editor="video"
          refreshKey={stripRefresh}
        />
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-zinc-200">
          Сохранённые шаблоны {loading ? "…" : `(${templates.length})`}
        </h2>
        {templates.map((t) => (
          <div
            key={t.id}
            className="rounded-xl border border-white/10 bg-[#0c0c0e] p-3"
          >
            <div className="flex gap-3">
              {t.previewImageUrl || t.previewVideoUrl ? (
                <div className="h-24 w-16 shrink-0 overflow-hidden rounded-lg bg-black">
                  {t.previewVideoUrl ? (
                    <video
                      src={t.previewVideoUrl}
                      muted
                      playsInline
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={t.previewImageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{t.title}</div>
                <div className="text-[11px] text-zinc-500">
                  {t.pricePeaches} 🍑 · {t.durationSec}с ·{" "}
                  {t.tgPublished ? "в TG" : "черновик"}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className="rounded-full border border-white/15 px-2 py-0.5 text-[10px]"
                    onClick={() => loadIntoForm(t)}
                  >
                    В форму
                  </button>
                  <button
                    type="button"
                    className="rounded-full border border-red-400/30 px-2 py-0.5 text-[10px] text-red-300"
                    onClick={() => void onDelete(t.id)}
                  >
                    Удалить
                  </button>
                </div>
              </div>
            </div>
            <TgPublishControls
              templateId={t.id}
              kind="lora_i2v"
              initialPublished={t.tgPublished}
              initialDisplayTitle={t.tgDisplayTitle || t.title}
              defaultTitle={t.title}
              initialSceneCategory={t.sceneCategory}
              onUpdated={() => void load()}
            />
          </div>
        ))}
        {!loading && templates.length === 0 ? (
          <p className="text-sm text-zinc-500">Пока пусто — собери первый рецепт.</p>
        ) : null}
      </div>
    </div>
  );
}
