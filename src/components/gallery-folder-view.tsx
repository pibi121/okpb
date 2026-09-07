"use client";

import { useState } from "react";
import { MediaLightbox } from "@/components/media-lightbox";
import type { GalleryJobStatus } from "@/lib/gallery-meta";

type Item = {
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

export function GalleryFolderView({
  folder,
  items,
}: {
  folder: Item;
  items: Item[];
}) {
  const [lightbox, setLightbox] = useState<{
    src: string;
    kind: "photo" | "video";
  } | null>(null);

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <article
            key={item.id}
            className="overflow-hidden rounded-lg border bg-white"
          >
            <button
              type="button"
              className="block w-full bg-zinc-100"
              onClick={() =>
                setLightbox({
                  src: item.resultUrl,
                  kind: item.kind === "photo" ? "photo" : "video",
                })
              }
            >
              {item.kind === "photo" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.resultUrl}
                  alt={item.title || ""}
                  className="aspect-[3/4] w-full object-cover"
                />
              ) : (
                <video
                  src={item.resultUrl}
                  className="aspect-[3/4] w-full object-cover"
                  muted
                  playsInline
                />
              )}
            </button>
            <div className="p-3 text-sm">
              <div className="font-medium">{item.title || item.kind}</div>
              {item.prompt ? (
                <p className="mt-1 line-clamp-3 text-xs text-zinc-600">
                  {item.prompt}
                </p>
              ) : null}
              {item.kind !== "photo" ? (
                <a
                  href={item.resultUrl}
                  download
                  className="mt-2 inline-block text-xs text-rose-800 underline"
                >
                  Скачать
                </a>
              ) : null}
            </div>
          </article>
        ))}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">
          В папке «{folder.title}» пока пусто
        </p>
      ) : null}
      {lightbox ? (
        <MediaLightbox
          src={lightbox.src}
          kind={lightbox.kind}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </div>
  );
}
