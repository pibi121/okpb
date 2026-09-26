"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PromptLegoEditor } from "@/components/prompt-lego-editor";
import { PhotoEditPromptPicker } from "@/components/photo-edit-prompt-picker";
import { TodayGenerationsStrip } from "@/components/today-generations-strip";
import { GalleryTgTransferButtons } from "@/components/gallery-tg-transfer-buttons";
import { PhotoFunnelSavePanel } from "@/components/photo-funnel-save-panel";
import {
  buildLegoCatalog,
  type LegoCatalogItem,
} from "@/lib/prompt-lego-core";
import { loadPhotoEditRestore } from "@/lib/generation-restore";

type PoseProp = {
  id: string;
  label: string;
  text: string;
  videoMotion?: string;
};

type LegoStatic = {
  lighting: Array<Omit<LegoCatalogItem, "kind">>;
  events: Array<Omit<LegoCatalogItem, "kind">>;
  stylization: Array<Omit<LegoCatalogItem, "kind">>;
  body?: Array<Omit<LegoCatalogItem, "kind">>;
};

type SavedTpl = {
  id: string;
  title: string;
  notes?: string;
  tgPublished?: boolean;
  tgDisplayTitle?: string;
  sceneCategory?: string;
  previewImageUrl?: string;
  previewVideoUrl?: string;
  animate?: import("@/lib/photo-template-animate").PhotoAnimateConfig;
};

async function readJson(res: Response) {
  const raw = await res.text();
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Сервер вернул не JSON (${res.status})`);
  }
}

export function PhotoEditLabClient({
  poses,
  lego,
}: {
  poses: PoseProp[];
  lego: LegoStatic;
}) {
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [useUndressStack, setUseUndressStack] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [stripRefresh, setStripRefresh] = useState(0);
  const [lastItemId, setLastItemId] = useState("");
  const [msg, setMsg] = useState("");
  const [labTemplates, setLabTemplates] = useState<SavedTpl[]>([]);
  const [editTplId, setEditTplId] = useState("");

  const catalog = useMemo(
    () =>
      buildLegoCatalog({
        poses,
        lighting: lego.lighting,
        events: lego.events,
        stylization: lego.stylization,
        body: lego.body || [],
        characters: [],
      }),
    [poses, lego],
  );

  const refreshTemplates = useCallback(() => {
    void fetch("/api/peach/photo-edit/templates")
      .then((r) => r.json())
      .then((d: { templates?: SavedTpl[] }) => {
        setLabTemplates(d.templates || []);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshTemplates();
    const restored = loadPhotoEditRestore();
    if (restored?.editPrompt?.trim()) {
      setQuery(restored.editPrompt);
      setMsg("Промпт возвращён из генерации (фото загрузи снова)");
    }
  }, [refreshTemplates]);

  useEffect(() => {
    if (!photoFile) {
      setPhotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(photoFile);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  async function generate() {
    setError("");
    setMsg("");
    if (!photoFile) {
      setError("Загрузи фото для эдита");
      return;
    }
    if (query.trim().length < 2) {
      setError("Заполни промпт");
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.set("photo", photoFile);
      form.set("editPrompt", query.trim());
      form.set("useUndressStack", useUndressStack ? "1" : "0");
      form.set("conceptLoraIds", "[]");
      form.set("title", "Photo edit");
      const res = await fetch("/api/peach/photo-edit/generate", {
        method: "POST",
        body: form,
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      const id = String(data.galleryItemId || "");
      setLastItemId(id);
      setStripRefresh((n) => n + 1);
      setMsg("В очереди Metalnode…");
      document.getElementById("today-generations")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setSubmitting(false);
    }
  }

  const editingTpl = labTemplates.find((t) => t.id === editTplId) || null;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[#121214] p-4">
          <div>
            <div className="mb-1.5 text-sm text-zinc-500">Фото для эдита</div>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 bg-[#0c0c0e] px-4 py-8 hover:border-peach/40">
              {photoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photoPreview}
                  alt=""
                  className="max-h-64 rounded-lg object-contain"
                />
              ) : (
                <span className="text-sm text-zinc-500">
                  Нажми или перетащи JPG/PNG
                </span>
              )}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
              />
            </label>
          </div>

          <div>
            <div className="mb-1.5 text-sm text-zinc-500">Промпт / сцена позы</div>
            <PromptLegoEditor
              catalog={catalog}
              characters={[]}
              selectedIds={[]}
              value={query}
              onChange={setQuery}
              disabled={submitting}
              variant="photo"
            />
            <div className="mt-3">
              <PhotoEditPromptPicker
                value={query}
                onChange={setQuery}
                compact
                hint="Готовые куски позы/света в LEGO-поле."
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={useUndressStack}
              onChange={(e) => setUseUndressStack(e.target.checked)}
              className="accent-peach"
            />
            Projector + Realism (как undress) — для качества naked-поз
          </label>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          {msg ? <p className="text-sm text-emerald-400">{msg}</p> : null}

          <button
            type="button"
            disabled={submitting}
            onClick={() => void generate()}
            className="rounded-full bg-peach px-4 py-2.5 text-sm font-medium text-black disabled:opacity-50"
          >
            {submitting ? "В очередь…" : "Сгенерировать (Identity Edit)"}
          </button>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#121214] p-4 text-sm">
          <p className="font-medium text-foreground">Lab 2.0 · позы</p>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-zinc-500">
            <li>Это новый генератор воронки — не старое «Фото» с LoRA.</li>
            <li>Загрузи фото → промпт позы → Identity Edit.</li>
            <li>
              Готовый кадр → «В шаблон» / форма ниже: кнопка, описание, тизер,
              оживление 3/7/12.
            </li>
            <li>«Изменить» возвращает промпт сюда, не в Lab 1.0.</li>
          </ol>
        </div>
      </div>

      <TodayGenerationsStrip
        kind="photo"
        editor="photo-edit"
        refreshKey={stripRefresh}
        hideSaveTemplate
        onPickItem={(item) => {
          setLastItemId(item.id);
          setMsg(`Кадр ${item.id.slice(0, 8)}… для шаблона воронки`);
        }}
      />

      {lastItemId ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#121214] p-4">
            <h3 className="text-sm font-medium">Последний кадр · действия</h3>
            <p className="text-xs text-zinc-500">
              id: <code className="text-zinc-400">{lastItemId}</code>
            </p>
            <GalleryTgTransferButtons
              itemId={lastItemId}
              kind="photo"
              defaultTitle="Photo edit"
            />
          </div>
          <PhotoFunnelSavePanel
            mode="create"
            galleryItemId={lastItemId}
            editPrompt={query}
            onSaved={(tpl) => {
              const row: SavedTpl = {
                id: tpl.id,
                title: tpl.title,
                notes: tpl.notes,
                tgPublished: tpl.tgPublished,
                tgDisplayTitle: tpl.tgDisplayTitle,
                sceneCategory: tpl.sceneCategory,
                previewImageUrl: tpl.previewImageUrl,
                previewVideoUrl: tpl.previewVideoUrl,
                animate: tpl.animate,
              };
              setLabTemplates((prev) => {
                const rest = prev.filter((p) => p.id !== row.id);
                return [row, ...rest];
              });
              setEditTplId(row.id);
              setMsg("Шаблон воронки создан");
            }}
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#121214] p-4">
        <h3 className="text-sm font-medium">Шаблоны поз · оживление</h3>
        <p className="text-xs text-zinc-500">
          Выбери шаблон → настрой тизер, кнопку и промпты оживления.
        </p>
        <select
          className="w-full max-w-md rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2 text-sm"
          value={editTplId}
          onChange={(e) => setEditTplId(e.target.value)}
        >
          <option value="">— выбрать —</option>
          {labTemplates.map((t) => (
            <option key={t.id} value={t.id}>
              {(t.tgDisplayTitle || t.title) +
                (t.tgPublished ? " · TG" : "")}
            </option>
          ))}
        </select>
        {editingTpl ? (
          <PhotoFunnelSavePanel
            key={editingTpl.id}
            mode="edit"
            initial={{
              id: editingTpl.id,
              title: editingTpl.title,
              notes: editingTpl.notes || "",
              tgDisplayTitle: editingTpl.tgDisplayTitle,
              tgPublished: editingTpl.tgPublished,
              sceneCategory: editingTpl.sceneCategory,
              previewImageUrl: editingTpl.previewImageUrl,
              previewVideoUrl: editingTpl.previewVideoUrl,
              animate: editingTpl.animate,
            }}
            onSaved={(tpl) => {
              const row: SavedTpl = {
                id: tpl.id,
                title: tpl.title,
                notes: tpl.notes,
                tgPublished: tpl.tgPublished,
                tgDisplayTitle: tpl.tgDisplayTitle,
                sceneCategory: tpl.sceneCategory,
                previewImageUrl: tpl.previewImageUrl,
                previewVideoUrl: tpl.previewVideoUrl,
                animate: tpl.animate,
              };
              setLabTemplates((prev) =>
                prev.map((p) => (p.id === row.id ? row : p)),
              );
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
