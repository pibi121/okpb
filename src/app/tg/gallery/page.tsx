"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TgShell, useTgMiniApp } from "@/lib/tg/miniapp/client";
import { ImageGeneration } from "@/components/image-generation";
import { BorderBeam } from "@/components/border-beam";
import {
  downloadGalleryItem,
  type TgGalleryItem,
} from "@/lib/tg/miniapp/generation-view";

import {
  TgBannerCarousel,
  useHorizontalBanners,
} from "@/lib/tg/miniapp/banners-ui";

const UI = {
  ru: {
    title: "🖼 Галерея",
    empty: "Пока пусто — сгенерируй первую работу в ленте",
    feed: "В ленту",
    download: "Скачать",
    photo: "Фото",
    video: "Видео",
    pending: "Генерация…",
    again: "Снять ещё",
    againHint: "Готово! Можно сразу сделать следующую генерацию.",
    lowBal: "Персиков мало — пополни, чтобы не останавливаться.",
    topup: "Пополнить баланс",
  },
  en: {
    title: "🖼 Gallery",
    empty: "Nothing yet — create your first work in the feed",
    feed: "Feed",
    download: "Download",
    photo: "Photo",
    video: "Video",
    pending: "Generating…",
    again: "Make another",
    againHint: "Done! Ready for the next generation.",
    lowBal: "Low on peaches — top up to keep going.",
    topup: "Top up balance",
  },
} as const;

function GalleryTile({
  item,
  locale,
  onOpen,
}: {
  item: TgGalleryItem;
  locale: "ru" | "en";
  onOpen: () => void;
}) {
  const u = UI[locale];

  if (item.status === "pending") {
    return (
      <div className="tg-gallery-tile tg-gallery-tile--pending">
        <BorderBeam className="h-full w-full">
          <div className="tg-gallery-pending">
            <ImageGeneration
              fill
              label={item.kind === "video" ? u.video : u.photo}
              prompt={item.title || item.prompt}
              resolution={
                item.width && item.height
                  ? `${item.width} × ${item.height}`
                  : item.kind === "video"
                    ? "HD"
                    : "Photo"
              }
            />
          </div>
        </BorderBeam>
        <span className="tg-gallery-badge">{u.pending}</span>
      </div>
    );
  }

  if (item.status === "error") {
    return (
      <div className="tg-gallery-tile tg-gallery-tile--error">
        <span>{item.error || "Error"}</span>
      </div>
    );
  }

  const url =
    item.resultUrl.startsWith("http") || typeof window === "undefined"
      ? item.resultUrl
      : `${window.location.origin}${item.resultUrl}`;

  return (
    <button type="button" className="tg-gallery-tile" onClick={onOpen}>
      {item.kind === "video" ? (
        <video src={url} muted playsInline className="tg-gallery-thumb" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="tg-gallery-thumb" />
      )}
      <span className="tg-gallery-badge">
        {item.kind === "video" ? "🎬" : "📸"}
      </span>
    </button>
  );
}

export default function TgGalleryPage() {
  const router = useRouter();
  const { status, error, profile, locale, apiFetch, sendAction } = useTgMiniApp();
  const u = UI[locale];
  const banners = useHorizontalBanners(apiFetch);

  const [items, setItems] = useState<TgGalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewer, setViewer] = useState<TgGalleryItem | null>(null);
  const [justGen, setJustGen] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch("/api/tg/gallery");
    if (!res.ok) return;
    const data = (await res.json()) as { items: TgGalleryItem[] };
    setItems(data.items || []);
    setLoading(false);
  }, [apiFetch]);

  useEffect(() => {
    if (status !== "ready") return;
    void load();
  }, [status, load]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("tg_just_generated");
      if (!raw) return;
      const parsed = JSON.parse(raw) as { at?: number };
      if (parsed.at && Date.now() - parsed.at < 10 * 60 * 1000) {
        setJustGen(true);
      }
      sessionStorage.removeItem("tg_just_generated");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (status !== "ready") return;
    const hasPending = items.some((i) => i.status === "pending");
    if (!hasPending) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [status, items, load]);

  if (status === "loading") return <p className="tg-loading">…</p>;
  if (status === "error") return <p className="tg-error">{error}</p>;

  const bal = profile?.balancePeaches ?? 0;
  const lowBal = bal < 80;

  if (viewer) {
    const url =
      viewer.resultUrl.startsWith("http")
        ? viewer.resultUrl
        : `${window.location.origin}${viewer.resultUrl}`;
    return (
      <TgShell locale={locale}>
        <div className="tg-section tg-gallery-viewer">
          <button type="button" className="tg-lang" onClick={() => setViewer(null)}>
            ←
          </button>
          <div className="tg-gen-preview">
            {viewer.kind === "video" ? (
              <video src={url} controls autoPlay playsInline className="tg-gen-media" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="" className="tg-gen-media" />
            )}
          </div>
          <div className="tg-gen-actions">
            <button
              type="button"
              className="tg-primary-btn"
              onClick={() => void downloadGalleryItem(viewer)}
            >
              ⬇ {u.download}
            </button>
          </div>
        </div>
      </TgShell>
    );
  }

  return (
    <TgShell locale={locale}>
      <TgBannerCarousel banners={banners} />
      {justGen ? (
        <div className="tg-soft-cta">
          <p className="tg-soft-cta-title">{u.againHint}</p>
          <div className="tg-soft-cta-row">
            <button
              type="button"
              className="tg-primary-btn"
              onClick={() => router.push("/tg/photo")}
            >
              📸 {u.photo}
            </button>
            <button
              type="button"
              className="tg-primary-btn"
              onClick={() => router.push("/tg/video")}
            >
              🎬 {u.video}
            </button>
          </div>
          {lowBal ? (
            <>
              <p className="tg-muted" style={{ marginTop: "0.55rem", fontSize: "0.85rem" }}>
                {u.lowBal}
              </p>
              <button
                type="button"
                className="tg-lang"
                style={{ marginTop: "0.35rem" }}
                onClick={() => sendAction({ action: "topup" })}
              >
                {u.topup}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {loading && <p className="tg-muted">…</p>}

      {!loading && items.length === 0 && (
        <div className="tg-muted">
          <p>{u.empty}</p>
          <button
            type="button"
            className="tg-primary-btn"
            style={{ marginTop: "1rem" }}
            onClick={() => router.push("/tg")}
          >
            {u.feed}
          </button>
        </div>
      )}

      <div className="tg-gallery-grid">
        {items.map((item) => (
          <GalleryTile
            key={item.id}
            item={item}
            locale={locale}
            onOpen={() => setViewer(item)}
          />
        ))}
      </div>
    </TgShell>
  );
}
