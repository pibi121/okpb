"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

/**
 * Catalog / grid video thumb — poster-first like the TG feed.
 * Cold (off-screen): <img> poster only (TG WebView paints black empty <video>).
 * Hot (visible): attach video src + muted autoplay.
 * Pass eager for detail / lightbox (always attach src).
 */
export function TgCatalogVideo({
  src,
  poster,
  className,
  style,
  onClick,
  eager = false,
}: {
  src: string;
  poster?: string | null;
  className?: string;
  style?: CSSProperties;
  onClick?: (el: HTMLVideoElement) => void;
  eager?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [hot, setHot] = useState(eager);
  const posterUrl = (poster || "").trim();
  const videoUrl = (src || "").trim();
  const showVideo = Boolean(videoUrl && (eager || hot));

  useEffect(() => {
    if (eager) {
      setHot(true);
      return;
    }
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          setHot(e.isIntersecting);
        }
      },
      { threshold: 0.2, rootMargin: "120px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [eager]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !showVideo || !videoUrl) return;

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
      if (v.readyState >= 2 && v.paused && v.currentTime < 0.05) {
        try {
          v.currentTime = 0.001;
        } catch {
          /* ignore */
        }
      }
      tryPlay();
    };

    v.addEventListener("loadeddata", onReady);
    v.addEventListener("canplay", onReady);
    tryPlay();

    return () => {
      v.removeEventListener("loadeddata", onReady);
      v.removeEventListener("canplay", onReady);
      v.pause();
    };
  }, [showVideo, videoUrl]);

  const wrapStyle: CSSProperties = {
    display: "block",
    width: "100%",
    ...(eager ? {} : { height: "100%" }),
    lineHeight: 0,
  };

  return (
    <div ref={wrapRef} style={wrapStyle}>
      {showVideo ? (
        <video
          ref={videoRef}
          src={videoUrl}
          poster={posterUrl || undefined}
          className={className}
          style={style}
          muted
          loop
          playsInline
          autoPlay
          preload="metadata"
          onClick={
            onClick
              ? (e) => {
                  e.stopPropagation();
                  onClick(e.currentTarget);
                }
              : undefined
          }
        />
      ) : posterUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={posterUrl}
          alt=""
          className={className}
          style={style}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div
          className={className}
          style={{
            ...style,
            width: "100%",
            height: "100%",
            minHeight: "4rem",
            background: "#1a1a1c",
          }}
          aria-hidden
        />
      )}
    </div>
  );
}
