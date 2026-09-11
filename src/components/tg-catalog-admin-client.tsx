"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Kind = "photo" | "video" | "lora_i2v";

type Item = {
  kind: Kind;
  id: string;
  title: string;
  displayTitle: string;
  tgPublished: boolean;
  published: boolean;
  pricePeaches: number;
  sortOrder: number;
  durationSec: number;
  previewUrl: string;
  previewVideoUrl: string;
  previewMissing?: boolean;
  labHref?: string;
  updatedAt: string;
};

const KIND_LABEL: Record<Kind, string> = {
  photo: "Фото",
  video: "Видео",
  lora_i2v: "Видео по фото",
};

const NEED_PREVIEW_IDS = new Set([
  "cmtmqh6480005o42ajx53bbij",
  "cmtmrlfy6000fo42aqyjvkw8s",
  "cmtmtdzo8000bqd2ade2cbkhj",
  "cmtmuhkbq000oqd2ap8zaac0z",
  "cmtotna5v0005s82al14y39ge",
  "cmtmzc9e20009lp2avdg94bto",
  "cmtoci66p0009qi2awxvlklsv",
  "cmton1zwj0007nw2akdexombu",
]);

export function TgCatalogAdminClient() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState<"all" | Kind | "broken">("broken");
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/peach/tg-catalog-admin");
      if (!res.ok) {
        setErr("Не удалось загрузить");
        setItems([]);
        return;
      }
      const data = (await res.json()) as { items: Item[] };
      setItems(data.items || []);
    } catch {
      setErr("Сеть");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((it) => {
      if (filter === "broken") {
        if (!(it.previewMissing || NEED_PREVIEW_IDS.has(it.id))) return false;
      } else if (filter !== "all" && it.kind !== filter) {
        return false;
      }
      if (!needle) return true;
      const hay = `${it.title} ${it.displayTitle} ${it.id}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [items, filter, q]);

  const brokenCount = useMemo(
    () =>
      items.filter((it) => it.previewMissing || NEED_PREVIEW_IDS.has(it.id))
        .length,
    [items],
  );

  const patch = async (
    item: Item,
    body: { displayTitle?: string; title?: string; tgPublished?: boolean },
  ) => {
    setBusyId(`${item.kind}:${item.id}`);
    setErr("");
    try {
      const res = await fetch(
        `/api/peach/tg-catalog-admin/${item.kind}/${encodeURIComponent(item.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(j.error || "Не удалось сохранить");
        return;
      }
      await load();
    } catch {
      setErr("Сеть");
    } finally {
      setBusyId("");
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">TG каталог</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Скрыть / переименовать шаблоны. Для битых превью: сгенерируй ролик в
          лабе → «Перенести в TG» или пришли ссылку на mp4.
        </p>
        {brokenCount > 0 ? (
          <p className="mt-2 text-sm text-amber-300/90">
            Нужно превью: {brokenCount} шт. (фильтр уже открыт)
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["broken", `Нет превью${brokenCount ? ` (${brokenCount})` : ""}`],
            ["all", "Все"],
            ["photo", KIND_LABEL.photo],
            ["video", KIND_LABEL.video],
            ["lora_i2v", KIND_LABEL.lora_i2v],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`rounded-full border px-3 py-1 text-xs ${
              filter === k
                ? "border-peach bg-peach/15 text-peach"
                : "border-zinc-700 text-zinc-400"
            }`}
            onClick={() => setFilter(k)}
          >
            {label}
          </button>
        ))}
        <input
          className="ml-auto min-w-[12rem] flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm"
          placeholder="Поиск…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          type="button"
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300"
          onClick={() => void load()}
        >
          Обновить
        </button>
      </div>

      {err ? <p className="text-sm text-red-400">{err}</p> : null}
      {loading ? <p className="text-sm text-zinc-500">Загрузка…</p> : null}
      {!loading && filtered.length === 0 ? (
        <p className="text-sm text-zinc-500">Ничего не найдено</p>
      ) : null}

      <div className="grid gap-3">
        {filtered.map((it) => {
          const key = `${it.kind}:${it.id}`;
          const busy = busyId === key;
          return (
            <CatalogRow
              key={key}
              item={it}
              busy={busy}
              onHide={() => void patch(it, { tgPublished: false })}
              onShow={() => void patch(it, { tgPublished: true })}
              onRename={(title, displayTitle) =>
                void patch(it, { title, displayTitle })
              }
            />
          );
        })}
      </div>
    </div>
  );
}

function CatalogRow({
  item,
  busy,
  onHide,
  onShow,
  onRename,
}: {
  item: Item;
  busy: boolean;
  onHide: () => void;
  onShow: () => void;
  onRename: (title: string, displayTitle: string) => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [displayTitle, setDisplayTitle] = useState(item.displayTitle);

  useEffect(() => {
    setTitle(item.title);
    setDisplayTitle(item.displayTitle);
  }, [item.title, item.displayTitle, item.id, item.kind]);

  const dirty =
    title.trim() !== item.title || displayTitle.trim() !== item.displayTitle;
  const missing = Boolean(item.previewMissing || NEED_PREVIEW_IDS.has(item.id));
  const labHref =
    item.labHref ||
    (item.kind === "video"
      ? `/peach/video?tab=create&qvTemplate=${item.id}`
      : item.kind === "lora_i2v"
        ? `/peach/lora-i2v?templateId=${item.id}`
        : "/peach/photo");

  return (
    <article
      className={`flex flex-col gap-3 rounded-xl border p-3 sm:flex-row ${
        missing
          ? "border-amber-700/50 bg-amber-950/20"
          : "border-zinc-800 bg-zinc-950/60"
      }`}
    >
      <div className="h-28 w-20 shrink-0 overflow-hidden rounded-lg bg-zinc-900 sm:h-32 sm:w-24">
        {item.previewUrl && !missing ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.previewUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-1 text-center text-[10px] text-amber-400/90">
            нет файла превью
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-zinc-300">
            {KIND_LABEL[item.kind]}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 ${
              item.tgPublished
                ? "bg-emerald-500/15 text-emerald-300"
                : "bg-zinc-800 text-zinc-500"
            }`}
          >
            {item.tgPublished ? "В TG" : "Скрыт в TG"}
          </span>
          {missing ? (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-300">
              Нужно превью
            </span>
          ) : null}
          <span className="text-zinc-500">{item.pricePeaches} 🍑</span>
          {item.durationSec > 0 ? (
            <span className="text-zinc-500">~{item.durationSec}с</span>
          ) : null}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-[11px] text-zinc-500">
            Название
            <input
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="block text-[11px] text-zinc-500">
            Название в TG (опционально)
            <input
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm"
              value={displayTitle}
              onChange={(e) => setDisplayTitle(e.target.value)}
              disabled={busy}
              placeholder={item.title}
            />
          </label>
        </div>
        <p className="truncate font-mono text-[10px] text-zinc-600">{item.id}</p>
        <div className="flex flex-wrap gap-2">
          {item.kind !== "photo" ? (
            <Link
              href={labHref}
              className="rounded-lg bg-peach/90 px-3 py-1.5 text-xs font-medium text-zinc-950"
            >
              Сделать видео →
            </Link>
          ) : null}
          <button
            type="button"
            disabled={busy || !dirty || !title.trim()}
            className="rounded-lg border border-zinc-600 px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-40"
            onClick={() => onRename(title.trim(), displayTitle.trim())}
          >
            Сохранить имя
          </button>
          {item.tgPublished ? (
            <button
              type="button"
              disabled={busy}
              className="rounded-lg border border-zinc-600 px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-40"
              onClick={onHide}
            >
              Скрыть из TG
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || missing}
              title={
                missing
                  ? "Сначала сгенерируй превью и перенеси в TG из лабы"
                  : undefined
              }
              className="rounded-lg border border-emerald-700/60 px-3 py-1.5 text-xs text-emerald-300 disabled:opacity-40"
              onClick={onShow}
            >
              Показать в TG
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
