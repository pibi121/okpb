"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { BannerDto } from "@/lib/tg/banners";

const VBANNER_SEEN_KEY = "pb_vbanner_seen_v1";
const VBANNER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function readSeenMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(VBANNER_SEEN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeSeenMap(map: Record<string, number>) {
  try {
    localStorage.setItem(VBANNER_SEEN_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota */
  }
}

/** Vertical banners not shown to this device in the last 24h (per banner id). */
export function filterVerticalBannersDue(banners: BannerDto[]): BannerDto[] {
  if (typeof window === "undefined") return banners;
  const map = readSeenMap();
  const now = Date.now();
  return banners.filter((b) => {
    const at = map[b.id];
    return !at || now - at >= VBANNER_COOLDOWN_MS;
  });
}

export function markVerticalBannersShown(bannerIds: string[]) {
  if (typeof window === "undefined" || !bannerIds.length) return;
  const map = readSeenMap();
  const now = Date.now();
  for (const id of bannerIds) {
    const clean = id.replace(/^banner-/, "");
    map[clean] = now;
    map[id] = now;
  }
  writeSeenMap(map);
}

function openHref(href: string, router: ReturnType<typeof useRouter>) {
  const raw = (href || "").trim();
  if (!raw) return;
  if (/^https?:\/\//i.test(raw)) {
    const tg = window.Telegram?.WebApp;
    if (tg?.openTelegramLink && /t\.me\//i.test(raw)) {
      tg.openTelegramLink(raw);
      return;
    }
    window.open(raw, "_blank", "noopener,noreferrer");
    return;
  }
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  router.push(path);
}

/** Horizontal auto-carousel under Mini App header (4s, peach dots). */
export function TgBannerCarousel({
  banners,
}: {
  banners: BannerDto[];
}) {
  const router = useRouter();
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (banners.length <= 1) return;
    const t = setInterval(() => {
      setIdx((i) => (i + 1) % banners.length);
    }, 4000);
    return () => clearInterval(t);
  }, [banners.length]);

  useEffect(() => {
    setIdx(0);
  }, [banners]);

  if (!banners.length) return null;
  const current = banners[Math.min(idx, banners.length - 1)];

  return (
    <div className="tg-banner-carousel">
      <button
        type="button"
        className="tg-banner-slide"
        onClick={() => openHref(current.href, router)}
        aria-label={current.label || "banner"}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current.imageUrl} alt="" />
      </button>
      {banners.length > 1 ? (
        <div className="tg-banner-dots" role="tablist">
          {banners.map((b, i) => (
            <button
              key={b.id}
              type="button"
              role="tab"
              aria-selected={i === idx}
              className={i === idx ? "is-active" : ""}
              onClick={() => setIdx(i)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function useHorizontalBanners(
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) {
  const [banners, setBanners] = useState<BannerDto[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch("/api/tg/banners?kind=horizontal");
        if (!res.ok) return;
        const data = (await res.json()) as { banners: BannerDto[] };
        if (!cancelled) setBanners(data.banners || []);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiFetch]);
  return banners;
}

export function TgFeedBannerCard({
  imageUrl,
  href,
  label,
}: {
  imageUrl: string;
  href: string;
  label?: string;
}) {
  const router = useRouter();
  return (
    <article className="tg-reel tg-reel--banner">
      <button
        type="button"
        className="tg-feed-banner"
        onClick={() => openHref(href, router)}
        aria-label={label || "banner"}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="" />
      </button>
    </article>
  );
}
