"use client";

import { useCallback, useEffect, useState } from "react";
import { ImageGeneration } from "@/components/image-generation";
import { BorderBeam } from "@/components/border-beam";
import type { GalleryJobStatus } from "@/lib/gallery-meta";

export type TgGalleryItem = {
  id: string;
  kind: string;
  title: string | null;
  prompt: string | null;
  resultUrl: string;
  width: number | null;
  height: number | null;
  status: GalleryJobStatus;
  error: string | null;
};

const UI = {
  ru: {
    photo: "Создаём фото…",
    video: "Создаём видео…",
    done: "Готово!",
    err: "Ошибка генерации",
    download: "Скачать",
    gallery: "В галерею",
    waiting: "Генерация…",
  },
  en: {
    photo: "Creating photo…",
    video: "Creating video…",
    done: "Done!",
    err: "Generation failed",
    download: "Download",
    gallery: "Gallery",
    waiting: "Generating…",
  },
} as const;

function absMediaUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (typeof window !== "undefined") {
    return `${window.location.origin}${url.startsWith("/") ? url : `/${url}`}`;
  }
  return url;
}

export async function downloadGalleryItem(item: TgGalleryItem) {
  const url = absMediaUrl(item.resultUrl);
  const ext = item.kind === "video" ? "mp4" : "png";
  const name = (item.title || "peachbitch").replace(/[^\w\u0400-\u04FF-]+/g, "_").slice(0, 40);

  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = `${name}.${ext}`;
    a.click();
    URL.revokeObjectURL(blobUrl);
    return;
  } catch {
    /* fallback */
  }

  const tg = window.Telegram?.WebApp;
  if (tg && "openLink" in tg) {
    (tg as { openLink: (u: string) => void }).openLink(url);
  } else {
    window.open(url, "_blank");
  }
}

export function TgGenerationProgress({
  galleryItemId,
  locale,
  apiFetch,
  onBalanceRefresh,
  onGoGallery,
}: {
  galleryItemId: string;
  locale: "ru" | "en";
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  onBalanceRefresh?: () => void | Promise<void>;
  onGoGallery?: () => void;
}) {
  const u = UI[locale];
  const [item, setItem] = useState<TgGalleryItem | null>(null);
  const [pollErr, setPollErr] = useState("");

  const poll = useCallback(async () => {
    const res = await apiFetch(`/api/tg/gallery?id=${encodeURIComponent(galleryItemId)}`);
    if (!res.ok) {
      setPollErr("load");
      return null;
    }
    const data = (await res.json()) as { item: TgGalleryItem };
    setItem(data.item);
    return data.item;
  }, [apiFetch, galleryItemId]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      const row = await poll();
      if (cancelled || !row) return;
      if (row.status === "pending") {
        timer = setTimeout(tick, 2500);
        return;
      }
      if (row.status === "ready") {
        void onBalanceRefresh?.();
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [poll, onBalanceRefresh]);

  if (pollErr) {
    return <p className="tg-error">{u.err}</p>;
  }

  if (!item || item.status === "pending") {
    const isVideo = item?.kind === "video";
    const res =
      item?.width && item?.height
        ? `${item.width} × ${item.height}`
        : isVideo
          ? "HD"
          : "Photo";
    return (
      <div className="tg-gen-progress">
        <BorderBeam>
          <div className="tg-gen-canvas" style={{ aspectRatio: isVideo ? "9/16" : "3/4" }}>
            <ImageGeneration
              fill
              label={isVideo ? u.video : u.photo}
              prompt={item?.title || item?.prompt}
              resolution={res}
            />
          </div>
        </BorderBeam>
        <p className="tg-muted" style={{ marginTop: "1rem" }}>
          {u.waiting}
        </p>
      </div>
    );
  }

  if (item.status === "error") {
    return (
      <div className="tg-section">
        <p className="tg-error">{item.error || u.err}</p>
      </div>
    );
  }

  const mediaUrl = absMediaUrl(item.resultUrl);

  return (
    <div className="tg-section tg-gen-result">
      <p className="tg-gen-done">{u.done}</p>
      <div className="tg-gen-preview">
        {item.kind === "video" ? (
          <video src={mediaUrl} controls playsInline className="tg-gen-media" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaUrl} alt="" className="tg-gen-media" />
        )}
      </div>
      <div className="tg-gen-actions">
        <button
          type="button"
          className="tg-primary-btn"
          onClick={() => void downloadGalleryItem(item)}
        >
          ⬇ {u.download}
        </button>
        {onGoGallery && (
          <button type="button" className="tg-secondary-btn" onClick={onGoGallery}>
            🖼 {u.gallery}
          </button>
        )}
      </div>
    </div>
  );
}
