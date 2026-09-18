"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { TgShell, useTgMiniApp } from "@/lib/tg/miniapp/client";
import { orderFeedMixed } from "@/lib/tg/feed-order";
import {
  MODE_LABELS,
  matchesFeedModeTab,
  modeBadgeForTemplate,
  modeNeedLine,
  type FeedModeTab,
  type ModeBadgeKind,
} from "@/lib/tg/gen-modes";
import { injectVerticalBanners, type BannerDto } from "@/lib/tg/banners";
import {
  TgFeedBannerCard,
  filterVerticalBannersDue,
  markVerticalBannersShown,
} from "@/lib/tg/miniapp/banners-ui";

type VideoTpl = {
  id: string;
  title: string;
  notes: string;
  previewVideoUrl: string;
  previewPhotoUrl: string;
  durationSec: number;
  pricePeaches: number;
  hasSpeech?: boolean;
  templateKind?: "quick_video" | "lora_i2v";
  requiresLora?: boolean;
  createdAt?: string;
  updatedAt?: string;
  identityKey?: string;
};

type PhotoTpl = {
  id: string;
  title: string;
  notes: string;
  pricePeaches: number;
  previewImageUrl: string;
  createdAt?: string;
  updatedAt?: string;
  identityKey?: string;
};

type FeedItem =
  | {
      kind: "video";
      id: string;
      title: string;
      notes: string;
      preview: string;
      poster?: string;
      isVideo: true;
      price: number;
      durationSec: number;
      hasSpeech?: boolean;
      bestQuality?: boolean;
      requiresLora?: boolean;
      createdAt: number;
      identityKey: string;
    }
  | {
      kind: "photo";
      id: string;
      title: string;
      notes: string;
      preview: string;
      isVideo: false;
      price: number;
      durationSec: number;
      createdAt: number;
      identityKey: string;
    };

type FeedRow =
  | FeedItem
  | {
      kind: "banner";
      id: string;
      imageUrl: string;
      href: string;
      label: string;
    };

const UI = {
  ru: {
    title: "Лента",
    empty: "Шаблоны скоро появятся",
    speech: "🗣 речь",
    soundOn: "Звук вкл",
    soundOff: "Звук выкл",
  },
  en: {
    title: "Feed",
    empty: "Templates coming soon",
    speech: "🗣 speech",
    soundOn: "Sound on",
    soundOff: "Sound off",
  },
} as const;

const MODE_TABS: FeedModeTab[] = [
  "all",
  "photo_look",
  "video_one",
  "video_look",
];

/** Only current slide ±1 attach full video src (poster for the rest). */
const MEDIA_WINDOW = 1;

function modeTabLabel(tab: FeedModeTab, locale: "ru" | "en"): string {
  const m = MODE_LABELS[locale];
  if (tab === "all") return m.tabAll;
  return m[tab];
}

function feedSortMs(createdAt?: string, updatedAt?: string): number {
  const c = Date.parse(createdAt || "") || 0;
  const u = Date.parse(updatedAt || "") || 0;
  return Math.max(c, u);
}

export default function TgFeedPage() {
  const router = useRouter();
  const { status, error, locale, apiFetch } = useTgMiniApp();
  const [tab, setTab] = useState<FeedModeTab>("all");
  const [items, setItems] = useState<FeedRow[]>([]);
  const [pool, setPool] = useState<FeedItem[]>([]);
  const [loadErr, setLoadErr] = useState("");
  const [vBanners, setVBanners] = useState<BannerDto[]>([]);
  /** Prefer unmuted like Reels; may fall back if autoplay blocks. */
  const [muted, setMuted] = useState(false);
  const [soundFlash, setSoundFlash] = useState<"on" | "off" | null>(null);
  /** Index of the most-visible feed row (for windowed media). */
  const [activeIdx, setActiveIdx] = useState(0);
  const reelRef = useRef<HTMLDivElement>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const u = UI[locale];
  const modeLabels = MODE_LABELS[locale];

  const flashSound = useCallback((nextMuted: boolean) => {
    setSoundFlash(nextMuted ? "off" : "on");
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setSoundFlash(null), 900);
  }, []);

  const applyMuteToVideos = useCallback((nextMuted: boolean) => {
    const root = reelRef.current;
    if (!root) return;
    root.querySelectorAll("video").forEach((node) => {
      const v = node as HTMLVideoElement;
      v.muted = nextMuted;
      if (!nextMuted) v.volume = 1;
    });
  }, []);

  const toggleSound = useCallback(
    (e: MouseEvent | { preventDefault: () => void; stopPropagation: () => void }) => {
      e.preventDefault();
      e.stopPropagation();
      const next = !mutedRef.current;
      setMuted(next);
      applyMuteToVideos(next);
      flashSound(next);
    },
    [applyMuteToVideos, flashSound],
  );

  const load = useCallback(async () => {
    setLoadErr("");
    const res = await apiFetch(`/api/tg/templates?kind=all&locale=${locale}`);
    if (!res.ok) {
      setLoadErr("load");
      return;
    }
    const data = (await res.json()) as { video: VideoTpl[]; photo: PhotoTpl[] };
    const feed: FeedItem[] = [];
    for (const v of data.video || []) {
      feed.push({
        kind: "video",
        id: v.id,
        title: v.title,
        notes: v.notes,
        preview: v.previewVideoUrl || "",
        poster: v.previewPhotoUrl || "",
        isVideo: true,
        price: v.pricePeaches > 0 ? v.pricePeaches : 0,
        durationSec: v.durationSec,
        hasSpeech: v.hasSpeech,
        bestQuality:
          v.templateKind === "lora_i2v" || Boolean(v.requiresLora),
        requiresLora:
          v.templateKind === "lora_i2v" || Boolean(v.requiresLora),
        createdAt: feedSortMs(v.createdAt, v.updatedAt),
        identityKey: v.identityKey || v.id,
      });
    }
    for (const p of data.photo || []) {
      feed.push({
        kind: "photo",
        id: p.id,
        title: p.title,
        notes: p.notes,
        preview: p.previewImageUrl,
        isVideo: false,
        price: p.pricePeaches,
        durationSec: 0,
        createdAt: feedSortMs(p.createdAt, p.updatedAt),
        identityKey: p.identityKey || p.id,
      });
    }
    setPool(feed);
  }, [locale, apiFetch]);

  useEffect(() => {
    if (status !== "ready") return;
    void load();
    void (async () => {
      try {
        const res = await apiFetch("/api/tg/banners?kind=vertical");
        if (!res.ok) return;
        const data = (await res.json()) as { banners: BannerDto[] };
        setVBanners(data.banners || []);
      } catch {
        /* ignore */
      }
    })();
  }, [status, load, apiFetch]);

  useEffect(() => {
    if (!pool.length) {
      setItems([]);
      return;
    }
    const filtered = pool.filter((item) =>
      matchesFeedModeTab(tab, {
        kind: item.kind,
        requiresLora: item.kind === "video" ? item.requiresLora : false,
        bestQuality: item.kind === "video" ? item.bestQuality : false,
      }),
    );
    const ordered = orderFeedMixed(filtered);
    const due = filterVerticalBannersDue(vBanners);
    const mixed = injectVerticalBanners(ordered, due);
    setItems(mixed);
    const shown = mixed
      .filter((row): row is Extract<FeedRow, { kind: "banner" }> => row.kind === "banner")
      .map((row) => row.id);
    if (shown.length) markVerticalBannersShown(shown);
  }, [pool, vBanners, tab]);

  useEffect(() => {
    const root = reelRef.current;
    if (!root) return;
    root.scrollTo({ top: 0, behavior: "auto" });
    setActiveIdx(0);
  }, [tab, items]);

  // Snap-scroll: pick the slide whose center is closest to the viewport center.
  // More reliable in TG WebView than IntersectionObserver thresholds alone.
  useEffect(() => {
    const root = reelRef.current;
    if (!root || !items.length) return;

    let raf = 0;
    const updateActive = () => {
      raf = 0;
      const slides = root.querySelectorAll<HTMLElement>("[data-feed-index]");
      if (!slides.length) return;
      const mid = root.getBoundingClientRect().top + root.clientHeight / 2;
      let bestIdx = 0;
      let bestDist = Infinity;
      for (const el of slides) {
        const raw = el.dataset.feedIndex;
        const idx = raw != null ? Number(raw) : -1;
        if (idx < 0 || Number.isNaN(idx)) continue;
        const r = el.getBoundingClientRect();
        const dist = Math.abs(r.top + r.height / 2 - mid);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = idx;
        }
      }
      setActiveIdx((prev) => (prev === bestIdx ? prev : bestIdx));
    };

    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(updateActive);
    };

    root.addEventListener("scroll", onScroll, { passive: true });
    updateActive();
    return () => {
      root.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [items]);

  // Play/pause videos in the hot window; TG WebView needs an explicit play().
  useEffect(() => {
    const root = reelRef.current;
    if (!root) return;
    const videos = root.querySelectorAll("video");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const v = e.target as HTMLVideoElement;
          if (!v.getAttribute("src") && !v.currentSrc) continue;
          v.muted = mutedRef.current;
          if (e.isIntersecting) {
            const p = v.play();
            if (p) {
              void p.catch(() => {
                // Autoplay with sound blocked — fall back to muted once.
                if (!mutedRef.current) {
                  v.muted = true;
                  setMuted(true);
                  mutedRef.current = true;
                  void v.play().catch(() => undefined);
                }
              });
            }
          } else {
            v.pause();
          }
        }
      },
      { root, threshold: 0.55 },
    );
    videos.forEach((v) => {
      const el = v as HTMLVideoElement;
      el.muted = mutedRef.current;
      io.observe(el);
      // Kick decode when src just attached (hot window moved).
      if (el.getAttribute("src") || el.currentSrc) {
        void el.play().catch(() => undefined);
      }
    });
    return () => io.disconnect();
  }, [items, activeIdx]);

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  if (status === "loading") return <p className="tg-loading">…</p>;
  if (status === "error") return <p className="tg-error">{error}</p>;

  return (
    <TgShell locale={locale}>
      <nav className="tg-tabs tg-tabs--sticky tg-tabs--modes">
        {MODE_TABS.map((t) => (
          <button
            key={t}
            type="button"
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {modeTabLabel(t, locale)}
          </button>
        ))}
      </nav>

      {loadErr && <p className="tg-error">Не удалось загрузить</p>}
      {!loadErr && items.length === 0 && <p className="tg-muted">{u.empty}</p>}

      <div className="tg-reels" ref={reelRef}>
        {items.map((item, index) => {
          const hot = Math.abs(index - activeIdx) <= MEDIA_WINDOW;
          if (item.kind === "banner") {
            return (
              <TgFeedBannerCard
                key={item.id}
                imageUrl={item.imageUrl}
                href={item.href}
                label={item.label}
                feedIndex={index}
              />
            );
          }
          return (
          <article
            key={`${item.kind}-${item.id}`}
            className="tg-reel"
            data-feed-index={index}
          >
            <div
              className="tg-reel-stage"
              onClick={item.isVideo ? toggleSound : undefined}
              role={item.isVideo ? "button" : undefined}
              tabIndex={item.isVideo ? 0 : undefined}
              onKeyDown={
                item.isVideo
                  ? (ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault();
                        toggleSound(ev);
                      }
                    }
                  : undefined
              }
            >
              {item.isVideo ? (
                // TG WebView often paints a black <video> when src is empty,
                // even with a poster attr — use <img> for cold slides.
                hot && item.preview ? (
                  <video
                    key={`v-${item.id}-hot`}
                    src={item.preview}
                    poster={item.poster || undefined}
                    className="tg-reel-media"
                    loop
                    muted={muted}
                    playsInline
                    preload="metadata"
                  />
                ) : item.poster ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={`v-${item.id}-poster`}
                    src={item.poster}
                    alt=""
                    className="tg-reel-media"
                    loading={hot ? "eager" : "lazy"}
                    decoding="async"
                  />
                ) : item.preview ? (
                  // No safe poster — keep a light metadata fetch so slide isn't black.
                  <video
                    key={`v-${item.id}-meta`}
                    src={item.preview}
                    className="tg-reel-media"
                    loop
                    muted
                    playsInline
                    preload="metadata"
                  />
                ) : (
                  <div className="tg-reel-media tg-reel-media--empty" aria-hidden />
                )
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.preview}
                  alt=""
                  className="tg-reel-media"
                  loading={hot ? "eager" : "lazy"}
                  decoding="async"
                />
              )}
              {item.isVideo && soundFlash ? (
                <span
                  className="tg-sound-flash"
                  aria-live="polite"
                  aria-label={soundFlash === "on" ? u.soundOn : u.soundOff}
                >
                  {soundFlash === "on" ? "🔊" : "🔇"}
                </span>
              ) : null}
            </div>
            <div className="tg-reel-dock">
              <strong>{item.title}</strong>
              {(() => {
                const mode: ModeBadgeKind = modeBadgeForTemplate({
                  kind: item.kind,
                  requiresLora:
                    item.kind === "video" ? item.requiresLora : false,
                  bestQuality:
                    item.kind === "video" ? item.bestQuality : false,
                });
                return (
                  <div className="tg-mode-badges">
                    <span className={`tg-mode-badge tg-mode-badge--${mode}`}>
                      {modeLabels[mode]}
                    </span>
                    {mode === "video_look" ? (
                      <span className="tg-best-badge">{modeLabels.maxQuality}</span>
                    ) : null}
                    <p className="tg-mode-need">{modeNeedLine(locale, mode)}</p>
                  </div>
                );
              })()}
              <div className="tg-reel-meta">
                <span className="tg-price">
                  {item.price} 🍑
                  {item.kind === "video" && item.durationSec
                    ? ` · ~${item.durationSec}с`
                    : ""}
                  {item.kind === "video" && item.hasSpeech ? ` · ${u.speech}` : ""}
                </span>
                <button
                  type="button"
                  className="tg-use-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (item.kind === "video") {
                      router.push(
                        `/tg/video?templateId=${encodeURIComponent(item.id)}`,
                      );
                      return;
                    }
                    router.push(
                      `/tg/photo?templateId=${encodeURIComponent(item.id)}`,
                    );
                  }}
                >
                  {item.kind === "video"
                    ? item.requiresLora || item.bestQuality
                      ? modeLabels.video_look
                      : modeLabels.video_one
                    : modeLabels.photo_look}
                </button>
              </div>
            </div>
          </article>
          );
        })}
      </div>
    </TgShell>
  );
}
