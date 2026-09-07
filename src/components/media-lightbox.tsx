"use client";

import { useEffect } from "react";

export function MediaLightbox({
  src,
  alt,
  kind = "photo",
  onClose,
}: {
  src: string;
  alt?: string;
  kind?: "photo" | "video";
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal
    >
      <button
        type="button"
        className="absolute right-4 top-4 rounded bg-white/90 px-3 py-1 text-sm"
        onClick={onClose}
      >
        Закрыть
      </button>
      <div
        className="max-h-[90vh] max-w-[95vw]"
        onClick={(e) => e.stopPropagation()}
      >
        {kind === "video" ? (
          <video
            src={src}
            controls
            autoPlay
            playsInline
            className="max-h-[90vh] max-w-[95vw] rounded"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={alt || ""}
            className="max-h-[90vh] max-w-[95vw] rounded object-contain"
          />
        )}
      </div>
    </div>
  );
}
