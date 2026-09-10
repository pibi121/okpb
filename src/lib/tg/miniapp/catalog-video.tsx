"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

/**
 * Catalog / feed / grid video thumb.
 * Telegram iOS WebView often shows a black <video> until play() — especially
 * without a poster. We always keep a visible still (poster or generated frame)
 * underneath until the video is actually playing.
 */
export function TgCatalogVideo({
  src,
  poster,
  className,
  style,
  onClick,
  /** When true, respect external muted state (feed sound toggle). Default muted. */
  muted: mutedProp = true,
  /** Feed: start only when mostly visible. Grid: earlier. */
  threshold = 0.25,
}: {
  src: string;
  poster?: string | null;
  className?: string;
  style?: CSSProperties;
  onClick?: (el: HTMLVideoElement) => void;
  muted?: boolean;
  threshold?: number;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [showStill, setShowStill] = useState(true);
  const [broken, setBroken] = useState(false);
  const [stillUrl, setStillUrl] = useState(poster?.trim() || "");
  const stillUrlRef = useRef(stillUrl);
  stillUrlRef.current = stillUrl;

  useEffect(() => {
    setStillUrl(poster?.trim() || "");
    setShowStill(true);
    setBroken(false);
  }, [src, poster]);

  useEffect(() => {
    const v = ref.current;
    if (!v || !src || broken) return;

    v.muted = mutedProp;
    v.defaultMuted = true;
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
    v.setAttribute("muted", "");

    const tryPlay = () => {
      v.muted = mutedProp;
      const p = v.play();
      if (p) {
        void p
          .then(() => {
            if (!v.paused && v.readyState >= 2) setShowStill(false);
          })
          .catch(() => {
            // Unmuted autoplay blocked in WebView — keep muted so preview still plays.
            if (!mutedProp) {
              v.muted = true;
              void v
                .play()
                .then(() => {
                  if (!v.paused && v.readyState >= 2) setShowStill(false);
                })
                .catch(() => undefined);
            }
          });
      }
    };

    const captureFrameAsStill = () => {
      if (stillUrlRef.current) return;
      try {
        if (v.videoWidth < 2 || v.videoHeight < 2) return;
        const canvas = document.createElement("canvas");
        canvas.width = Math.min(720, v.videoWidth);
        canvas.height = Math.round(
          (canvas.width / v.videoWidth) * v.videoHeight,
        );
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const data = canvas.toDataURL("image/jpeg", 0.72);
        if (data.startsWith("data:image")) setStillUrl(data);
      } catch {
        /* cross-origin / security — ignore */
      }
    };

    const onReady = () => {
      if (v.readyState >= 2 && v.currentTime < 0.05) {
        try {
          v.currentTime = 0.04;
        } catch {
          /* ignore */
        }
      }
      captureFrameAsStill();
      tryPlay();
    };

    const onPlaying = () => {
      captureFrameAsStill();
      setShowStill(false);
    };

    const onPause = () => {
      // Keep last frame visible via video element; still stays as backup.
    };

    const onError = () => {
      setBroken(true);
      setShowStill(true);
    };

    v.addEventListener("loadeddata", onReady);
    v.addEventListener("canplay", onReady);
    v.addEventListener("playing", onPlaying);
    v.addEventListener("pause", onPause);
    v.addEventListener("error", onError);

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) tryPlay();
          else v.pause();
        }
      },
      { threshold, rootMargin: "120px" },
    );
    io.observe(v);
    tryPlay();

    return () => {
      v.removeEventListener("loadeddata", onReady);
      v.removeEventListener("canplay", onReady);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("error", onError);
      io.disconnect();
      v.pause();
    };
  }, [src, broken, mutedProp, threshold]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = mutedProp;
    if (!v.paused && !mutedProp) v.volume = 1;
  }, [mutedProp]);

  return (
    <div className={`tg-catalog-video ${className || ""}`} style={style}>
      {showStill || broken ? (
        stillUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={stillUrl}
            alt=""
            className="tg-catalog-video-still"
            draggable={false}
          />
        ) : (
          <div className="tg-catalog-video-skeleton" aria-hidden />
        )
      ) : null}
      {!broken ? (
        <video
          ref={ref}
          src={src}
          poster={poster || undefined}
          className="tg-catalog-video-el"
          style={{ opacity: showStill ? 0 : 1 }}
          muted={mutedProp}
          loop
          playsInline
          autoPlay
          preload="auto"
          onClick={(e) => {
            e.stopPropagation();
            onClick?.(e.currentTarget);
          }}
        />
      ) : null}
    </div>
  );
}
