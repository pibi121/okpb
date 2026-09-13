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
import {
  emptyLoraI2vShot,
  newLoraI2vShotId,
  parseLoraI2vShotsPlan,
  type LoraI2vShotSpec,
} from "@/lib/lora-i2v-shots";

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
  shotsJson?: string;
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

type ShotForm = LoraI2vShotSpec & {
  stillItemId: string;
  stillUrl: string;
  videoItemId: string;
  videoUrl: string;
};

const DRAFT_KEY = "peach:lora-i2v-lab-draft:v1";

type LabDraft = {
  characterId: string;
  title: string;
  notes: string;
  orientation: VideoOrientationId;
  categories: string[];
  editingId: string;
  shots: ShotForm[];
  stitchedVideoItemId: string;
  stitchedVideoUrl: string;
  stitchedDurationSec: number;
  savedAt: number;
};

function emptyShotForm(partial?: Partial<ShotForm>): ShotForm {
  const base = emptyLoraI2vShot(partial);
  return {
    ...base,
    id: partial?.id || base.id || newLoraI2vShotId(),
    stillItemId: partial?.stillItemId || "",
    stillUrl: partial?.stillUrl || "",
    videoItemId: partial?.videoItemId || "",
    videoUrl: partial?.videoUrl || "",
  };
}

function readDraft(): LabDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as LabDraft;
    if (!Array.isArray(data.shots) || !data.shots.length) return null;
    return data;
  } catch {
    return null;
  }
}

async function readJson(res: Response) {
  const raw = await res.text();
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(
      `Сервер вернул не JSON (${res.status})${
        res.status === 502 || res.status === 504
          ? " — таймаут/прокси. Обнови страницу после фикса или подожди и нажми Склеить снова."
          : ""
      }`,
    );
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
  const [busyShotId, setBusyShotId] = useState("");
  const [stripRefresh, setStripRefresh] = useState(0);

  const [characterId, setCharacterId] = useState(loraChars[0]?.id || "");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [orientation, setOrientation] = useState<VideoOrientationId>("9_16");
  const [categories, setCategories] = useState<string[]>([]);
  const [shots, setShots] = useState<ShotForm[]>([emptyShotForm()]);

  const [editingId, setEditingId] = useState("");
  const [stitchedVideoItemId, setStitchedVideoItemId] = useState("");
  const [stitchedVideoUrl, setStitchedVideoUrl] = useState("");
  const [stitchedDurationSec, setStitchedDurationSec] = useState(0);
  const [draftRestored, setDraftRestored] = useState(false);

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

  // Restore lab draft once (survives refresh / deploy). Skip if URL has templateId.
  useEffect(() => {
    if (draftRestored) return;
    if (presetTemplateId) {
      setDraftRestored(true);
      return;
    }
    const draft = readDraft();
    setDraftRestored(true);
    if (!draft) return;
    const hasWork = draft.shots.some(
      (s) =>
        s.stillPrompt.trim() ||
        s.i2vPrompt.trim() ||
        s.stillItemId ||
        s.videoItemId ||
        s.stillUrl ||
        s.videoUrl,
    );
    if (!hasWork) return;
    setCharacterId(draft.characterId || "");
    setTitle(draft.title || "");
    setNotes(draft.notes || "");
    setOrientation(draft.orientation || "9_16");
    setCategories(Array.isArray(draft.categories) ? draft.categories : []);
    setEditingId(draft.editingId || "");
    setShots(draft.shots.map((s) => emptyShotForm(s)));
    setStitchedVideoItemId(draft.stitchedVideoItemId || "");
    setStitchedVideoUrl(draft.stitchedVideoUrl || "");
    setStitchedDurationSec(draft.stitchedDurationSec || 0);
    setMsg("Восстановлен черновик из браузера — шоты на месте");
  }, [draftRestored, presetTemplateId]);

  // Autosave draft — never wipe shots on stitch errors.
  useEffect(() => {
    if (!draftRestored) return;
    if (typeof window === "undefined") return;
    const payload: LabDraft = {
      characterId,
      title,
      notes,
      orientation,
      categories,
      editingId,
      shots,
      stitchedVideoItemId,
      stitchedVideoUrl,
      stitchedDurationSec,
      savedAt: Date.now(),
    };
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
    } catch {
      /* quota */
    }
  }, [
    draftRestored,
    characterId,
    title,
    notes,
    orientation,
    categories,
    editingId,
    shots,
    stitchedVideoItemId,
    stitchedVideoUrl,
    stitchedDurationSec,
  ]);

  useEffect(() => {
    if (!presetTemplateId || !templates.length || editingId) return;
    const hit = templates.find((t) => t.id === presetTemplateId);
    if (hit) loadIntoForm(hit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetTemplateId, templates]);

  useEffect(() => {
    if (!characterId && loraChars[0]) setCharacterId(loraChars[0].id);
  }, [characterId, loraChars]);

  function updateShot(id: string, patch: Partial<ShotForm>) {
    setShots((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    );
  }

  function addShot() {
    setShots((prev) => [...prev, emptyShotForm()]);
    setStitchedVideoItemId("");
    setStitchedVideoUrl("");
    setStitchedDurationSec(0);
    setMsg("Добавлен новый шот");
  }

  function removeShot(id: string) {
    setShots((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((s) => s.id !== id);
    });
    setStitchedVideoItemId("");
    setStitchedVideoUrl("");
    setStitchedDurationSec(0);
  }

  async function pollItem(
    id: string,
    opts: { maxAttempts: number; intervalMs: number; label: string },
  ): Promise<{
    id: string;
    resultUrl: string;
  } | null> {
    for (let i = 0; i < opts.maxAttempts; i++) {
      setMsg(`${opts.label}… ${i + 1}/${opts.maxAttempts}`);
      const res = await fetch(`/api/peach/gallery/${id}`);
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "gallery"));
      const item = (data.item || data) as {
        id: string;
        resultUrl?: string;
        status?: string;
      };
      if (item.status === "error") {
        throw new Error("Генерация упала — смотри галерею / логи");
      }
      if (
        item.status === "ready" &&
        item.resultUrl &&
        !/placeholder/i.test(item.resultUrl)
      ) {
        return { id: item.id, resultUrl: item.resultUrl };
      }
      await new Promise((r) => setTimeout(r, opts.intervalMs));
    }
    return null;
  }

  async function onStill(shotId: string) {
    const shot = shots.find((s) => s.id === shotId);
    if (!shot) return;
    setError("");
    setMsg("");
    setBusy("still");
    setBusyShotId(shotId);
    try {
      const res = await fetch("/api/peach/lora-i2v/still", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterId,
          stillPrompt: shot.stillPrompt,
          negativePrompt: shot.negativePrompt || undefined,
          orientationId: orientation,
          title: title || undefined,
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      const item = data.item as { id: string };
      updateShot(shotId, {
        stillItemId: item.id,
        stillUrl: "",
        videoItemId: "",
        videoUrl: "",
      });
      setStitchedVideoItemId("");
      setStitchedVideoUrl("");
      setStitchedDurationSec(0);
      setStripRefresh((n) => n + 1);
      setMsg(`Шот: still в очереди GPU…`);
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
      updateShot(shotId, { stillUrl: ready.resultUrl, stillItemId: ready.id });
      setMsg("Still готов — можно оживлять");
      setStripRefresh((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy("");
      setBusyShotId("");
    }
  }

  async function onAnimate(shotId: string) {
    const shot = shots.find((s) => s.id === shotId);
    if (!shot) return;
    setError("");
    setMsg("");
    if (!shot.stillItemId) {
      setError("Сначала сделай still");
      return;
    }
    if (!shot.i2vPrompt.trim()) {
      setError("Нужен I2V-промпт (движение)");
      return;
    }
    setBusy("animate");
    setBusyShotId(shotId);
    try {
      const res = await fetch("/api/peach/lora-i2v/animate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stillItemId: shot.stillItemId,
          i2vPrompt: shot.i2vPrompt,
          durationSec: shot.durationSec,
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      const item = data.item as { id: string };
      updateShot(shotId, { videoItemId: item.id, videoUrl: "" });
      setStitchedVideoItemId("");
      setStitchedVideoUrl("");
      setStitchedDurationSec(0);
      setStripRefresh((n) => n + 1);
      setMsg("I2V в очереди GPU (обычно 10–25 мин)…");
      const ready = await pollItem(item.id, {
        maxAttempts: 360,
        intervalMs: 5000,
        label: "Ждём I2V",
      });
      if (!ready) {
        throw new Error(
          "Таймаут I2V (~30 мин). Видео может ещё считаться — открой Галерею или нажми «Дождаться видео».",
        );
      }
      updateShot(shotId, { videoUrl: ready.resultUrl, videoItemId: ready.id });
      setMsg(
        shots.length > 1
          ? "Клип готов — когда все шоты ок, нажми «Склеить»"
          : "Видео готово — сохрани шаблон",
      );
      setStripRefresh((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy("");
      setBusyShotId("");
    }
  }

  async function onResumeVideoPoll(shotId: string) {
    const shot = shots.find((s) => s.id === shotId);
    if (!shot?.videoItemId) {
      setError("Нет video id — сначала запусти оживление");
      return;
    }
    setError("");
    setBusy("animate");
    setBusyShotId(shotId);
    try {
      setMsg("Продолжаем ждать I2V…");
      const ready = await pollItem(shot.videoItemId, {
        maxAttempts: 360,
        intervalMs: 5000,
        label: "Ждём I2V",
      });
      if (!ready) {
        throw new Error(
          "Всё ещё нет ready. Смотри Галерею — если error, перезапусти оживление.",
        );
      }
      updateShot(shotId, { videoUrl: ready.resultUrl });
      setMsg("Видео готово");
      setStripRefresh((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy("");
      setBusyShotId("");
    }
  }

  async function attachGallery(
    shotId: string,
    kind: "photo" | "video",
    inputId: string,
  ) {
    const el = document.getElementById(inputId) as HTMLInputElement | null;
    const id = el?.value.trim();
    if (!id) return;
    setError("");
    setBusy(kind === "photo" ? "still" : "animate");
    setBusyShotId(shotId);
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
      if (item.kind !== kind) {
        throw new Error(kind === "photo" ? "Нужен kind=photo" : "Нужен kind=video");
      }
      if (kind === "photo") {
        if (item.status && item.status !== "ready") {
          throw new Error(`Still status: ${item.status}`);
        }
        if (!item.resultUrl || /placeholder/i.test(item.resultUrl)) {
          throw new Error("У кадра нет файла");
        }
        updateShot(shotId, {
          stillItemId: item.id,
          stillUrl: item.resultUrl,
          videoItemId: "",
          videoUrl: "",
        });
        setMsg("Still подключён из галереи");
      } else {
        updateShot(shotId, {
          videoItemId: item.id,
          videoUrl:
            item.resultUrl && !/placeholder/i.test(item.resultUrl)
              ? item.resultUrl
              : "",
        });
        if (!item.resultUrl || /placeholder/i.test(item.resultUrl)) {
          setMsg("Видео pending — ждём…");
          const ready = await pollItem(item.id, {
            maxAttempts: 360,
            intervalMs: 5000,
            label: "Ждём I2V",
          });
          if (!ready) throw new Error("Таймаут ожидания видео");
          updateShot(shotId, {
            videoItemId: ready.id,
            videoUrl: ready.resultUrl,
          });
        }
        setMsg("Видео подключено из галереи");
      }
      setStitchedVideoItemId("");
      setStitchedVideoUrl("");
      setStitchedDurationSec(0);
      setStripRefresh((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy("");
      setBusyShotId("");
    }
  }

  async function onStitch() {
    setError("");
    setMsg("");
    // Snapshot ids so a re-render / draft restore cannot empty the request mid-flight.
    const ready = shots.filter((s) => s.videoItemId && s.videoUrl);
    const videoItemIds = ready.map((s) => s.videoItemId);
    if (ready.length < 2) {
      setError("Нужно минимум два готовых клипа");
      return;
    }
    if (ready.length !== shots.length) {
      setError("Сначала дождись видео по всем шотам");
      return;
    }
    setBusy("stitch");
    try {
      const res = await fetch("/api/peach/lora-i2v/stitch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoItemIds,
          title: title || "LoRA I2V stitch",
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "ошибка склейки"));
      const item = data.item as { id: string; resultUrl?: string };
      setStitchedVideoItemId(item.id);
      setStitchedDurationSec(Number(data.durationSec) || 0);
      if (data.pending || !item.resultUrl || /placeholder/i.test(item.resultUrl || "")) {
        setMsg("Склейка в очереди… шоты не трогаем");
        const done = await pollItem(item.id, {
          maxAttempts: 240,
          intervalMs: 3000,
          label: "Ждём склейку",
        });
        if (!done) {
          throw new Error(
            "Таймаут склейки. Шоты на месте — нажми «Склеить» ещё раз или Дождаться по id ниже.",
          );
        }
        setStitchedVideoUrl(done.resultUrl);
        setStitchedVideoItemId(done.id);
      } else {
        setStitchedVideoUrl(String(data.resultUrl || item.resultUrl));
      }
      setMsg("Склейка готова — сохрани шаблон");
      setStripRefresh((n) => n + 1);
    } catch (e) {
      // Do not clear shots / stills / clips on stitch failure — only show the error.
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy("");
    }
  }

  async function onSave() {
    setError("");
    setMsg("");
    const recipeShots = shots.filter(
      (s) => s.stillPrompt.trim() && s.i2vPrompt.trim(),
    );
    if (!recipeShots.length) {
      setError("Нужен хотя бы один шот с still + I2V промптами");
      return;
    }

    const multi = recipeShots.length > 1;
    if (multi && !stitchedVideoUrl) {
      setError("Сначала склей клипы кнопкой «Склеить»");
      return;
    }

    const first = recipeShots[0]!;
    const previewImageUrl = first.stillUrl || shots.find((s) => s.stillUrl)?.stillUrl || "";
    const previewVideoUrl = multi
      ? stitchedVideoUrl
      : first.videoUrl || "";
    const sourceStillId = first.stillItemId || "";
    const sourceVideoId = multi
      ? stitchedVideoItemId
      : first.videoItemId || "";

    if (!previewVideoUrl) {
      setError(multi ? "Нет склеенного видео" : "Сначала оживи still");
      return;
    }

    setBusy("save");
    try {
      const durationSec = multi
        ? stitchedDurationSec ||
          recipeShots.reduce((sum, s) => sum + (s.durationSec || 6), 0)
        : first.durationSec || 6;
      const payload = {
        title: title.trim() || "LoRA I2V",
        notes,
        stillPrompt: first.stillPrompt,
        i2vPrompt: recipeShots.map((s) => s.i2vPrompt).join("\n\n"),
        negativePrompt: first.negativePrompt || "",
        shots: recipeShots.map((s) => ({
          id: s.id,
          stillPrompt: s.stillPrompt,
          i2vPrompt: s.i2vPrompt,
          negativePrompt: s.negativePrompt || "",
          durationSec: s.durationSec,
        })),
        orientation,
        durationSec,
        pricePeaches: 0,
        sceneCategory: formatPhotoSceneCategories(categories),
        previewImageUrl,
        previewVideoUrl,
        sourceStillId,
        sourceVideoId,
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
    setOrientation((t.orientation as VideoOrientationId) || "9_16");
    setCategories(parsePhotoSceneCategories(t.sceneCategory));
    const plan = parseLoraI2vShotsPlan(t.shotsJson);
    if (plan?.shots.length) {
      setShots(
        plan.shots.map((s, i) =>
          emptyShotForm({
            ...s,
            stillItemId: i === 0 ? t.sourceStillId : "",
            stillUrl: i === 0 ? t.previewImageUrl : "",
            videoItemId: plan.shots.length === 1 ? t.sourceVideoId : "",
            videoUrl: plan.shots.length === 1 ? t.previewVideoUrl : "",
          }),
        ),
      );
      if (plan.shots.length > 1) {
        setStitchedVideoItemId(t.sourceVideoId);
        setStitchedVideoUrl(t.previewVideoUrl);
        setStitchedDurationSec(t.durationSec || 0);
      } else {
        setStitchedVideoItemId("");
        setStitchedVideoUrl("");
        setStitchedDurationSec(0);
      }
    } else {
      setShots([
        emptyShotForm({
          stillPrompt: t.stillPrompt,
          i2vPrompt: t.i2vPrompt,
          negativePrompt: t.negativePrompt,
          durationSec: Math.min(12, t.durationSec || 6),
          stillItemId: t.sourceStillId,
          stillUrl: t.previewImageUrl,
          videoItemId: t.sourceVideoId,
          videoUrl: t.previewVideoUrl,
        }),
      ]);
      setStitchedVideoItemId("");
      setStitchedVideoUrl("");
      setStitchedDurationSec(0);
    }
    setMsg("");
    setError("");
  }

  function resetForm() {
    setEditingId("");
    setTitle("");
    setNotes("");
    setShots([emptyShotForm()]);
    setCategories([]);
    setStitchedVideoItemId("");
    setStitchedVideoUrl("");
    setStitchedDurationSec(0);
    setMsg("");
    setError("");
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
  }

  const readyClipCount = shots.filter((s) => s.videoUrl && s.videoItemId).length;
  const canStitch = shots.length >= 2 && readyClipCount === shots.length;
  const totalDurationHint = shots.reduce(
    (sum, s) => sum + (s.durationSec || 6),
    0,
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <div className="space-y-4 rounded-xl border border-white/10 bg-[#0c0c0e] p-4">
        <div>
          <h2 className="text-sm font-medium text-zinc-200">Сборка рецепта</h2>
          <p className="mt-1 text-[11px] text-zinc-500">
            На каждый шот: still (Krea+LoRA) → оживление MiniMax → при нескольких
            шотах «Склеить» → сохранить шаблон → справа «В Telegram».
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

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-zinc-500">
            Ориентация
            <div className="mt-1">
              <OrientationSelect value={orientation} onChange={setOrientation} />
            </div>
          </label>
          <div className="block text-xs text-zinc-500">
            Цена 🍑
            <p className="mt-1 rounded-lg border border-white/10 bg-zinc-900/80 px-2 py-2 text-sm text-zinc-300">
              Авто из /ops/prices (premium × ~{stitchedDurationSec || totalDurationHint}с).
            </p>
          </div>
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

        {shots.map((shot, idx) => {
          const shotBusy = busyShotId === shot.id;
          return (
            <div
              key={shot.id}
              className="space-y-3 rounded-xl border border-white/10 bg-black/30 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                  Шот {idx + 1}
                </h3>
                {shots.length > 1 ? (
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => removeShot(shot.id)}
                    className="text-[10px] text-red-300/80 hover:text-red-300 disabled:opacity-40"
                  >
                    Удалить шот
                  </button>
                ) : null}
              </div>

              <label className="block text-xs text-zinc-500">
                Длительность I2V (сек)
                <input
                  type="number"
                  min={4}
                  max={12}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-zinc-900 px-2 py-2 text-sm"
                  value={shot.durationSec}
                  onChange={(e) =>
                    updateShot(shot.id, {
                      durationSec: Number(e.target.value) || 6,
                    })
                  }
                />
              </label>

              <label className="block text-xs text-zinc-500">
                Still-промпт (Krea + LoRA)
                <textarea
                  className="mt-1 min-h-[100px] w-full rounded-lg border border-white/10 bg-zinc-900 px-2 py-2 text-sm"
                  value={shot.stillPrompt}
                  onChange={(e) =>
                    updateShot(shot.id, { stillPrompt: e.target.value })
                  }
                  placeholder="pose, camera, wardrobe, scene… (trigger подставится сам)"
                />
              </label>
              <PhotoEditPromptPicker
                value={shot.stillPrompt}
                onChange={(v) => updateShot(shot.id, { stillPrompt: v })}
                hint="Клик добавляет текст в still-промпт"
              />

              <label className="block text-xs text-zinc-500">
                Negative (опционально)
                <textarea
                  className="mt-1 min-h-[56px] w-full rounded-lg border border-white/10 bg-zinc-900 px-2 py-2 text-sm"
                  value={shot.negativePrompt || ""}
                  onChange={(e) =>
                    updateShot(shot.id, { negativePrompt: e.target.value })
                  }
                />
              </label>

              <label className="block text-xs text-zinc-500">
                I2V-промпт (движение Minimax)
                <textarea
                  className="mt-1 min-h-[80px] w-full rounded-lg border border-white/10 bg-zinc-900 px-2 py-2 text-sm"
                  value={shot.i2vPrompt}
                  onChange={(e) =>
                    updateShot(shot.id, { i2vPrompt: e.target.value })
                  }
                  placeholder="…says {{s1}}…&#10;&#10;SPEECH_SLOTS:&#10;s1 | speaker=her | lang=ru | text=Мужчина"
                />
                <span className="mt-1 block text-[11px] text-zinc-600">
                  Речь: плейсхолдеры {"{{s1}}"} + блок SPEECH_SLOTS.
                </span>
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={
                    !!busy || !characterId || !shot.stillPrompt.trim()
                  }
                  onClick={() => void onStill(shot.id)}
                  className="rounded-full bg-peach px-3 py-1.5 text-xs font-medium text-black disabled:opacity-40"
                >
                  {shotBusy && busy === "still"
                    ? "Still…"
                    : "1. Сгенерировать still"}
                </button>
                <button
                  type="button"
                  disabled={
                    !!busy || !shot.stillItemId || !shot.i2vPrompt.trim()
                  }
                  onClick={() => void onAnimate(shot.id)}
                  className="rounded-full border border-peach/40 bg-peach/10 px-3 py-1.5 text-xs text-peach disabled:opacity-40"
                >
                  {shotBusy && busy === "animate"
                    ? "I2V…"
                    : "2. Оживить (I2V)"}
                </button>
                {shot.videoItemId && !shot.videoUrl ? (
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => void onResumeVideoPoll(shot.id)}
                    className="rounded-full border border-amber-500/40 px-3 py-1.5 text-xs text-amber-200 disabled:opacity-40"
                  >
                    Дождаться видео
                  </button>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-white/10 bg-black/40 p-2">
                  <div className="mb-1 text-[10px] uppercase text-zinc-500">
                    Still
                  </div>
                  {shot.stillUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={shot.stillUrl}
                      alt=""
                      className="max-h-64 w-full object-contain"
                    />
                  ) : (
                    <p className="text-[11px] text-zinc-600">ещё нет</p>
                  )}
                  {shot.stillItemId ? (
                    <p className="mt-1 truncate text-[10px] text-zinc-600">
                      id: {shot.stillItemId}
                    </p>
                  ) : null}
                  <label className="mt-2 block text-[10px] text-zinc-500">
                    Или gallery id still
                    <div className="mt-1 flex gap-1">
                      <input
                        className="min-w-0 flex-1 rounded border border-white/10 bg-zinc-900 px-2 py-1 text-[11px]"
                        placeholder="cm…"
                        id={`li2v-still-attach-${shot.id}`}
                      />
                      <button
                        type="button"
                        className="shrink-0 rounded border border-white/15 px-2 py-1 text-[10px]"
                        disabled={!!busy}
                        onClick={() =>
                          void attachGallery(
                            shot.id,
                            "photo",
                            `li2v-still-attach-${shot.id}`,
                          )
                        }
                      >
                        Взять
                      </button>
                    </div>
                  </label>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/40 p-2">
                  <div className="mb-1 text-[10px] uppercase text-zinc-500">
                    Video
                  </div>
                  {shot.videoUrl ? (
                    <video
                      src={shot.videoUrl}
                      controls
                      playsInline
                      className="max-h-64 w-full object-contain"
                    />
                  ) : (
                    <p className="text-[11px] text-zinc-600">ещё нет</p>
                  )}
                  {shot.videoItemId ? (
                    <p className="mt-1 truncate text-[10px] text-zinc-600">
                      id: {shot.videoItemId}
                    </p>
                  ) : null}
                  <label className="mt-2 block text-[10px] text-zinc-500">
                    Или gallery id video
                    <div className="mt-1 flex gap-1">
                      <input
                        className="min-w-0 flex-1 rounded border border-white/10 bg-zinc-900 px-2 py-1 text-[11px]"
                        placeholder="cm…"
                        id={`li2v-video-attach-${shot.id}`}
                      />
                      <button
                        type="button"
                        className="shrink-0 rounded border border-white/15 px-2 py-1 text-[10px]"
                        disabled={!!busy}
                        onClick={() =>
                          void attachGallery(
                            shot.id,
                            "video",
                            `li2v-video-attach-${shot.id}`,
                          )
                        }
                      >
                        Взять
                      </button>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          );
        })}

        <button
          type="button"
          disabled={!!busy}
          onClick={addShot}
          className="w-full rounded-xl border border-dashed border-peach/40 bg-peach/5 px-3 py-3 text-sm text-peach hover:bg-peach/10 disabled:opacity-40"
        >
          + Добавить шот
        </button>

        {stitchedVideoUrl ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
            <div className="mb-1 text-[10px] uppercase text-emerald-300/80">
              Склеенный ролик
            </div>
            <video
              src={stitchedVideoUrl}
              controls
              playsInline
              className="max-h-72 w-full object-contain"
            />
            {stitchedVideoItemId ? (
              <p className="mt-1 truncate text-[10px] text-zinc-600">
                id: {stitchedVideoItemId}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!!busy || !canStitch}
            onClick={() => void onStitch()}
            className="rounded-full border border-sky-400/40 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-200 disabled:opacity-40"
          >
            {busy === "stitch"
              ? "Склейка…"
              : `Склеить (${readyClipCount}/${shots.length})`}
          </button>
          <button
            type="button"
            disabled={
              !!busy ||
              !shots.some((s) => s.stillPrompt.trim() && s.i2vPrompt.trim())
            }
            onClick={() => void onSave()}
            className="rounded-full border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-300 disabled:opacity-40"
          >
            {busy === "save"
              ? "…"
              : editingId
                ? "Сохранить / обновить шаблон"
                : "Сохранить шаблон"}
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
