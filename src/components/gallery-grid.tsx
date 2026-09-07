"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AnimatePhotoModal, type AnimatePhotoItem } from "@/components/animate-photo-modal";
import { AddToTemplateButton } from "@/components/add-to-template-button";
import { GalleryTgTransferButtons } from "@/components/gallery-tg-transfer-buttons";
import { usePeachUiMode } from "@/components/peach-ui-mode-provider";
import { MediaLightbox } from "@/components/media-lightbox";
import { BorderBeam } from "@/components/border-beam";
import { ImageGeneration } from "@/components/image-generation";
import type { GalleryJobStatus } from "@/lib/gallery-meta";

type Item = {
  id: string;
  kind: string;
  title: string | null;
  prompt: string | null;
  resultUrl: string;
  width: number | null;
  height: number | null;
  createdAt: string;
  status: GalleryJobStatus;
  error: string | null;
};

function mediaAspect(item: Item) {
  if (item.width && item.height) return `${item.width} / ${item.height}`;
  return item.kind === "photo" || item.kind === "film_folder" ? "3 / 4" : "9 / 16";
}

function GalleryMedia({
  item,
  onOpen,
}: {
  item: Item;
  onOpen?: () => void;
}) {
  const aspect = mediaAspect(item);
  const boxClass =
    "flex w-full items-center justify-center bg-zinc-100 min-h-[200px] max-h-[70vh]";

  if (item.status === "pending") {
    const res =
      item.width && item.height
        ? `${item.width} × ${item.height}`
        : item.kind === "video"
          ? "MiniMax"
          : "Krea";
    return (
      <div className={boxClass} style={{ aspectRatio: aspect }}>
        <ImageGeneration
          fill
          prompt={item.title || item.prompt}
          resolution={res}
          label={item.kind === "video" ? "Создаём видео…" : "Создаём фото…"}
        />
      </div>
    );
  }

  if (item.status === "error") {
    return (
      <div
        className={`${boxClass} border-b border-red-100 bg-red-50`}
        style={{ aspectRatio: aspect }}
      >
        <div className="px-4 text-center">
          <p className="text-sm font-medium text-red-800">Ошибка</p>
          <p className="mt-1 text-xs text-red-700">{item.error || "не удалось"}</p>
        </div>
      </div>
    );
  }

  if (item.kind === "film_folder") {
    return (
      <Link href={`/peach/gallery/${item.id}`} className="block">
        <div className={boxClass} style={{ aspectRatio: aspect }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.resultUrl}
            alt={item.title || "folder"}
            className="max-h-[70vh] max-w-full object-contain"
          />
        </div>
      </Link>
    );
  }

  if (item.kind === "photo") {
    return (
      <button type="button" className="block w-full" onClick={onOpen}>
        <div className={boxClass} style={{ aspectRatio: aspect }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.resultUrl}
            alt={item.title || item.kind}
            className="max-h-[70vh] max-w-full object-contain"
          />
        </div>
      </button>
    );
  }

  return (
    <button type="button" className="block w-full" onClick={onOpen}>
      <div className={boxClass} style={{ aspectRatio: aspect }}>
        <video
          src={item.resultUrl}
          playsInline
          muted
          className="max-h-[70vh] max-w-full object-contain"
        />
      </div>
    </button>
  );
}

export function GalleryGrid({ initialItems }: { initialItems: Item[] }) {
  const router = useRouter();
  const { isAdmin } = usePeachUiMode();
  const [items, setItems] = useState(initialItems);
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [animateItem, setAnimateItem] = useState<AnimatePhotoItem | null>(null);
  const [lightbox, setLightbox] = useState<{
    src: string;
    kind: "photo" | "video";
  } | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  const refreshItems = useCallback(async () => {
    const res = await fetch("/api/peach/gallery");
    if (!res.ok) return;
    const data = (await res.json()) as { items: Item[] };
    setItems(data.items);
  }, []);

  const hasPending = items.some((i) => i.status === "pending");

  useEffect(() => {
    if (!hasPending) return;
    const t = setInterval(() => {
      void refreshItems();
    }, 2500);
    return () => clearInterval(t);
  }, [hasPending, refreshItems]);

  async function call(action: string, body: Record<string, unknown>) {
    const res = await fetch("/api/peach/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "error");
      return;
    }
    setEditId(null);
    setEditText("");
    if (action === "regen") {
      setNotice("Regen поставлен в очередь — новый кадр появится сверху списка.");
    }
    await refreshItems();
    router.refresh();
  }

  async function remove(id: string) {
    await fetch(`/api/peach/gallery?id=${id}`, { method: "DELETE" });
    await refreshItems();
    router.refresh();
  }

  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-500">
        Галерея пуста — сгенерируй фото или видео.
      </p>
    );
  }

  return (
    <div>
      {notice ? (
        <p className="mb-3 rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
          {notice}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const card = (
            <article className="relative z-10 rounded-2xl border border-zinc-200 bg-white">
            <div className="overflow-hidden rounded-t-2xl">
            <GalleryMedia
              item={item}
              onOpen={() =>
                setLightbox({
                  src: item.resultUrl,
                  kind: item.kind === "photo" ? "photo" : "video",
                })
              }
            />
            </div>
            <div className="relative z-20 flex flex-col gap-2 p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">
                    {item.kind === "film_folder" ? "📁 " : ""}
                    {item.title || item.kind}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {item.kind === "film_folder" ? "папка мини-фильма" : item.kind}
                    {item.status === "pending" ? " · в очереди" : ""}
                    {item.status === "error" ? " · ошибка" : ""}
                  </div>
                </div>
                <div className="flex gap-1">
                  {item.kind === "photo" && item.status === "ready" ? (
                    <button
                      type="button"
                      title="Edit"
                      className="rounded border px-2 py-1 text-xs"
                      onClick={() => {
                        setEditId(item.id);
                        setEditText("");
                      }}
                    >
                      ✎
                    </button>
                  ) : null}
                  {item.kind === "photo" && item.status === "ready" ? (
                    <button
                      type="button"
                      className="rounded border px-2 py-1 text-xs"
                      onClick={() => call("regen", { itemId: item.id })}
                    >
                      ↻
                    </button>
                  ) : null}
                </div>
              </div>

              {item.prompt ? (
                <p className="line-clamp-3 text-xs text-zinc-600">{item.prompt}</p>
              ) : null}

              {editId === item.id ? (
                <div className="flex flex-col gap-2 rounded bg-zinc-50 p-2">
                  <textarea
                    rows={2}
                    className="rounded border border-zinc-300 px-2 py-1 text-xs"
                    placeholder="change her hair to bright red…"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                  />
                  <button
                    type="button"
                    className="rounded bg-zinc-900 px-2 py-1 text-xs text-white"
                    disabled={!editText.trim()}
                    onClick={() =>
                      call("edit", { itemId: item.id, editPrompt: editText })
                    }
                  >
                    Применить edit
                  </button>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-1">
                {item.kind === "film_folder" ? (
                  <Link
                    href={`/peach/gallery/${item.id}`}
                    className="rounded bg-zinc-900 px-2 py-1 text-xs text-white"
                  >
                    Открыть папку
                  </Link>
                ) : null}
                {item.kind === "photo" && item.status === "ready" ? (
                  <button
                    type="button"
                    className="rounded bg-rose-800 px-2 py-1 text-xs text-white"
                    onClick={() =>
                      setAnimateItem({
                        id: item.id,
                        title: item.title,
                        prompt: item.prompt,
                        resultUrl: item.resultUrl,
                      })
                    }
                  >
                    Оживить
                  </button>
                ) : null}
                {item.status === "ready" && (item.kind === "photo" || item.kind === "video") ? (
                  <AddToTemplateButton
                    itemId={item.id}
                    kind={item.kind}
                    onDone={() => void refreshItems()}
                  />
                ) : null}
                {isAdmin && item.status === "ready" && (item.kind === "photo" || item.kind === "video") ? (
                  <GalleryTgTransferButtons
                    itemId={item.id}
                    kind={item.kind}
                    defaultTitle={item.title || item.prompt}
                    onDone={() => void refreshItems()}
                  />
                ) : null}
                <button
                  type="button"
                  className="rounded border px-2 py-1 text-xs text-zinc-500"
                  onClick={() => remove(item.id)}
                >
                  Удалить
                </button>
              </div>
            </div>
          </article>
          );
          return item.status === "pending" ? (
            <BorderBeam key={item.id}>{card}</BorderBeam>
          ) : (
            <div key={item.id}>{card}</div>
          );
        })}
      </div>
      {animateItem ? (
        <AnimatePhotoModal
          item={animateItem}
          onClose={() => setAnimateItem(null)}
          onQueued={() => {
            setAnimateItem(null);
            void refreshItems();
            router.refresh();
          }}
        />
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
