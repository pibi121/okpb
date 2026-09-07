"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { TgShell, useTgMiniApp } from "@/lib/tg/miniapp/client";
import { orderFeedMixed, orderFeedNewest } from "@/lib/tg/feed-order";

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

const UI = {
  ru: {
    title: "Лента",
    all: "Все",
    video: "Видео",
    photo: "Фото",
    shootVideo: "Снять видео",
    makePhoto: "Сделать фото",
    empty: "Шаблоны скоро появятся",
    speech: "🗣 речь",
    newest: "Новое",
    bestQuality: "Макс. качество",
    soundOn: "Звук вкл",
    soundOff: "Звук выкл",
  },
  en: {
    title: "Feed",
    all: "All",
    video: "Video",
    photo: "Photo",
    shootVideo: "Shoot video",
    makePhoto: "Make photo",
    empty: "Templates coming soon",
    speech: "🗣 speech",
    newest: "New",
    bestQuality: "Max quality",
    soundOn: "Sound on",
    soundOff: "Sound off",
  },
} as const;

function feedSortMs(createdAt?: string, updatedAt?: string): number {
  const c = Date.parse(createdAt || "") || 0;
  const u = Date.parse(updatedAt || "") || 0;
  return Math.max(c, u);
}

export default function TgFeedPage() {
  const router = useRouter();
  const { status, error, locale, apiFetch } = useTgMiniApp();
  const [tab, setTab] = useState<"all" | "video" | "photo">("all");
  const [items, setItems] = useState<FeedItem[]>([]);
  const [pool, setPool] = useState<FeedItem[]>([]);
  const [newest, setNewest] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  /** Prefer unmuted like Reels; may fall back if autoplay blocks. */
  const [muted, setMuted] = useState(false);
  const [soundFlash, setSoundFlash] = useState<"on" | "off" | null>(null);
  const reelRef = useRef<HTMLDivElement>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const u = UI[locale];

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
    const res = await apiFetch(`/api/tg/templates?kind=${tab}&locale=${locale}`);
    if (!res.ok) {
      setLoadErr("load");
      return;
    }
    const data = (await res.json()) as { video: VideoTpl[]; photo: PhotoTpl[] };
    const feed: FeedItem[] = [];
    if (tab !== "photo") {
      for (const v of data.video || []) {
        feed.push({
          kind: "video",
          id: v.id,
          title: v.title,
          notes: v.notes,
          preview: v.previewVideoUrl || "",
          poster: v.previewPhotoUrl || "",
          isVideo: true,
          price: v.pricePeaches || 142,
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
    }
    if (tab !== "video") {
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
    }
    setPool(feed);
  }, [tab, locale, apiFetch]);

  useEffect(() => {
    if (status !== "ready") return;
    void load();
  }, [status, load]);

  useEffect(() => {
    if (!pool.length) {
      setItems([]);
      return;
    }
    setItems(newest ? orderFeedNewest(pool) : orderFeedMixed(pool));
  }, [pool, newest]);

  useEffect(() => {
    const root = reelRef.current;
    if (!root) return;
    root.scrollTo({ top: 0, behavior: "auto" });
  }, [newest, items]);

  useEffect(() => {
    const root = reelRef.current;
    if (!root) return;
    const videos = root.querySelectorAll("video");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const v = e.target as HTMLVideoElement;
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
      { threshold: 0.6 },
    );
    videos.forEach((v) => {
      (v as HTMLVideoElement).muted = mutedRef.current;
      io.observe(v);
    });
    return () => io.disconnect();
  }, [items]);

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  if (status === "loading") return <p className="tg-loading">…</p>;
  if (status === "error") return <p className="tg-error">{error}</p>;

  return (
    <TgShell locale={locale}>
      <nav className="tg-tabs tg-tabs--sticky">
        {(["all", "video", "photo"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t === "all" ? u.all : t === "video" ? u.video : u.photo}
          </button>
        ))}
        <label className={`tg-new-toggle${newest ? " is-on" : ""}`}>
          {u.newest}
          <input
            type="checkbox"
            checked={newest}
            onChange={(e) => setNewest(e.target.checked)}
          />
        </label>
      </nav>

      {loadErr && <p className="tg-error">Не удалось загрузить</p>}
      {!loadErr && items.length === 0 && <p className="tg-muted">{u.empty}</p>}

      <div className="tg-reels" ref={reelRef}>
        {items.map((item) => (
          <article key={`${item.kind}-${item.id}`} className="tg-reel">
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
                <video
                  src={item.preview}
                  poster={item.poster || undefined}
                  className="tg-reel-media"
                  loop
                  muted={muted}
                  playsInline
                  preload="metadata"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.preview} alt="" className="tg-reel-media" />
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
              {item.kind === "video" && item.bestQuality ? (
                <span className="tg-best-badge">{u.bestQuality}</span>
              ) : null}
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
                  {item.kind === "video" ? u.shootVideo : u.makePhoto}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </TgShell>
  );
}
