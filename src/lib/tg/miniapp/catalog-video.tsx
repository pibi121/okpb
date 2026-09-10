"use client";

import { useEffect, useRef, type CSSProperties } from "react";

/**
 * Catalog / grid video thumb.
 * iOS Telegram WebView often paints black for <video preload="metadata">
 * until play() — especially without a poster. Autoplay muted when visible.
 */
export function TgCatalogVideo({
  src,
  poster,
  className,
  style,
  onClick,
}: {
  src: string;
  poster?: string | null;
  className?: string;
  style?: CSSProperties;
  onClick?: (el: HTMLVideoElement) => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v || !src) return;

    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");

    const tryPlay = () => {
      v.muted = true;
      const p = v.play();
      if (p) void p.catch(() => undefined);
    };

    const onReady = () => {
      // Force decode of first frame if still paused/black.
      if (v.readyState >= 2 && v.paused && v.currentTime < 0.05) {
        try {
          v.currentTime = 0.001;
        } catch {
          /* ignore seek errors before enough data */
        }
      }
      tryPlay();
    };

    v.addEventListener("loadeddata", onReady);
    v.addEventListener("canplay", onReady);

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) tryPlay();
          else v.pause();
        }
      },
      { threshold: 0.25, rootMargin: "80px" },
    );
    io.observe(v);

    // Kick once in case already in viewport.
    tryPlay();

    return () => {
      v.removeEventListener("loadeddata", onReady);
      v.removeEventListener("canplay", onReady);
      io.disconnect();
      v.pause();
    };
  }, [src]);

  return (
    <video
      ref={ref}
      src={src}
      poster={poster || undefined}
      className={className}
      style={style}
      muted
      loop
      playsInline
      autoPlay
      preload="auto"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e.currentTarget);
      }}
    />
  );
}
