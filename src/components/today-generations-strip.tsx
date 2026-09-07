"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RestoreToEditorButton } from "@/components/restore-to-editor-button";
import { ImageGeneration } from "@/components/image-generation";
import { PhotoSaveTemplateModal } from "@/components/photo-save-template-modal";

export type TodayItem = {
  id: string;
  kind: string;
  title: string | null;
  prompt?: string | null;
  resultUrl: string;
  status: string;
  createdAt: string;
  width?: number | null;
  height?: number | null;
  meta?: Record<string, unknown>;
};

export function SavePhotoTemplateButton({
  item,
  compact,
}: {
  item: TodayItem;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (item.status !== "ready" || item.kind !== "photo") return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          compact
            ? "rounded-full border border-white/20 bg-black/40 px-2 py-1 text-[10px] text-white"
            : "rounded-lg border border-white/15 px-2 py-1 text-xs hover:border-peach/40"
        }
        title="Сохранить рецепт сцены как шаблон"
      >
        Шаблон
      </button>
      <PhotoSaveTemplateModal
        open={open}
        sourceGalleryId={item.id}
        defaultTitle={item.title || "Photo template"}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

function isTodayLocal(iso: string): boolean {
  const d = new Date(iso);
  const n = new Date();
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  );
}

async function readJson(res: Response) {
  const raw = await res.text();
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Сервер вернул не JSON (${res.status})`);
  }
}

export function TodayGenerationsStrip({
  kind,
  editor,
  pollMs = 3000,
  refreshKey = 0,
  forceStoryRestore,
  onlyStoryH3,
}: {
  kind: "photo" | "video";
  editor: "photo" | "video";
  pollMs?: number;
  /** Bump after enqueue — triggers immediate refresh + faster polling. */
  refreshKey?: number;
  forceStoryRestore?: boolean;
  /** Story lab: show only Story H3 runs in the strip. */
  onlyStoryH3?: boolean;
}) {
  const [items, setItems] = useState<TodayItem[]>([]);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/peach/generations/today?kind=${kind}`);
    const data = await readJson(res);
    if (!res.ok) throw new Error(String(data.error || "ошибка"));
    let list = (data.items as TodayItem[]) || [];
    if (onlyStoryH3) {
      const { isStoryH3Meta } = await import("@/lib/generation-restore");
      list = list.filter(
        (i) =>
          isStoryH3Meta(i.meta, i.prompt) ||
          isStoryH3Meta(
            i.meta,
            typeof i.meta?.shotsJson === "string"
              ? String(i.meta.shotsJson)
              : null,
          ),
      );
    }
    setItems(list);
  }, [kind, onlyStoryH3]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh, refreshKey]);

  const anyPending = items.some((i) => i.status === "pending");

  useEffect(() => {
    if (!anyPending) return;
    const t = setInterval(() => {
      void refresh().catch(() => undefined);
    }, pollMs);
    return () => clearInterval(t);
  }, [anyPending, pollMs, refresh]);

  const today = useMemo(
    () => items.filter((i) => isTodayLocal(i.createdAt)),
    [items],
  );

  if (!today.length) {
    return (
      <p className="text-xs text-zinc-600">
        Сегодняшние {kind === "photo" ? "фото" : "видео"} появятся здесь. Старше — в{" "}
        <Link href="/peach/gallery" className="text-peach hover:underline">
          галерее
        </Link>
        .
      </p>
    );
  }

  return (
    <div id="today-generations" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">
          Сегодня ({today.length})
          {anyPending ? (
            <span className="ml-2 text-xs font-normal text-peach">· генерация…</span>
          ) : null}
        </h3>
        <Link href="/peach/gallery" className="text-xs text-peach hover:underline">
          Вся галерея
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {today.map((item) => (
          <div
            key={item.id}
            className="group relative overflow-hidden rounded-xl border border-white/10 bg-[#121214]"
          >
            {item.status === "pending" ? (
              <div className={kind === "video" ? "aspect-[9/16] w-full" : "w-full"}>
                <ImageGeneration
                  fill
                  prompt={item.title || item.prompt}
                  resolution={
                    item.width && item.height
                      ? `${item.width} × ${item.height}`
                      : kind === "video"
                        ? "MiniMax"
                        : "Krea"
                  }
                  label={kind === "photo" ? "Создаём фото…" : "Создаём видео…"}
                />
              </div>
            ) : item.kind === "video" || item.resultUrl.endsWith(".mp4") ? (
              <video
                src={item.resultUrl}
                className="aspect-[9/16] w-full object-cover"
                muted
                playsInline
                preload="metadata"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.resultUrl}
                alt=""
                className="aspect-[3/4] w-full object-cover"
              />
            )}
            <div className="absolute inset-x-0 bottom-0 flex gap-1 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 transition group-hover:opacity-100">
              <RestoreToEditorButton
                item={item}
                editor={editor}
                compact
                forceStoryRestore={forceStoryRestore}
              />
              {kind === "photo" ? (
                <SavePhotoTemplateButton item={item} compact />
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
