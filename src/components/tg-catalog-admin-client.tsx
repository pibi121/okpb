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

type PromptShot = {
  id?: string;
  stillPrompt?: string;
  i2vPrompt?: string;
  legoQuery?: string;
  durationSec?: number;
};

type PromptPayload = {
  ok?: boolean;
  kind: Kind;
  id: string;
  title: string;
  mode: "photo" | "single" | "multi" | "story" | "shots" | "raw";
  editPrompt?: string;
  stillPrompt?: string;
  i2vPrompt?: string;
  prompt?: string;
  shots?: PromptShot[];
  error?: string;
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
  const [filter, setFilter] = useState<"all" | Kind | "broken">("all");
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState("");
  const [editItem, setEditItem] = useState<Item | null>(null);

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
    body: Record<string, unknown>,
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
        return false;
      }
      await load();
      return true;
    } catch {
      setErr("Сеть");
      return false;
    } finally {
      setBusyId("");
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">TG каталог</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Скрыть / переименовать /{" "}
          <span className="text-zinc-300">редактировать промпты</span>. После
          «Сохранить» шаблон сразу обновляется для бота и Mini App.
        </p>
        {brokenCount > 0 ? (
          <p className="mt-2 text-sm text-amber-300/90">
            Нужно превью: {brokenCount} шт.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["all", "Все"],
            ["broken", `Нет превью${brokenCount ? ` (${brokenCount})` : ""}`],
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
              onEditPrompt={() => setEditItem(it)}
            />
          );
        })}
      </div>

      {editItem ? (
        <PromptEditModal
          item={editItem}
          onClose={() => setEditItem(null)}
          onSave={async (body) => {
            const ok = await patch(editItem, body);
            if (ok) setEditItem(null);
            return ok;
          }}
        />
      ) : null}
    </div>
  );
}

function CatalogRow({
  item,
  busy,
  onHide,
  onShow,
  onRename,
  onEditPrompt,
}: {
  item: Item;
  busy: boolean;
  onHide: () => void;
  onShow: () => void;
  onRename: (title: string, displayTitle: string) => void;
  onEditPrompt: () => void;
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
          <button
            type="button"
            disabled={busy}
            className="rounded-lg bg-peach/90 px-3 py-1.5 text-xs font-medium text-zinc-950 disabled:opacity-40"
            onClick={onEditPrompt}
          >
            Редактировать промпт
          </button>
          {item.kind !== "photo" ? (
            <Link
              href={labHref}
              className="rounded-lg border border-zinc-600 px-3 py-1.5 text-xs text-zinc-300"
            >
              Открыть в лабе →
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

function PromptEditModal({
  item,
  onClose,
  onSave,
}: {
  item: Item;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [payload, setPayload] = useState<PromptPayload | null>(null);
  const [editPrompt, setEditPrompt] = useState("");
  const [stillPrompt, setStillPrompt] = useState("");
  const [i2vPrompt, setI2vPrompt] = useState("");
  const [prompt, setPrompt] = useState("");
  const [shots, setShots] = useState<PromptShot[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const res = await fetch(
          `/api/peach/tg-catalog-admin/${item.kind}/${encodeURIComponent(item.id)}`,
        );
        const data = (await res.json()) as PromptPayload;
        if (!res.ok) {
          if (!cancelled) setErr(data.error || "Не удалось загрузить промпт");
          return;
        }
        if (cancelled) return;
        setPayload(data);
        setEditPrompt(data.editPrompt || "");
        setStillPrompt(data.stillPrompt || "");
        setI2vPrompt(data.i2vPrompt || "");
        setPrompt(data.prompt || "");
        setShots(data.shots || []);
      } catch {
        if (!cancelled) setErr("Сеть");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item.id, item.kind]);

  const save = async () => {
    if (!payload) return;
    setSaving(true);
    setErr("");
    try {
      let body: Record<string, unknown> = {};
      if (payload.mode === "photo") {
        body = { editPrompt };
      } else if (payload.kind === "lora_i2v" && payload.mode === "multi") {
        body = { shots };
      } else if (payload.kind === "lora_i2v") {
        body = { stillPrompt, i2vPrompt };
      } else if (payload.mode === "shots") {
        body = { shots };
      } else {
        body = { prompt };
      }
      const ok = await onSave(body);
      if (!ok) setErr("Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-[#121214] shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-800 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-medium text-zinc-100">
              Промпт · {KIND_LABEL[item.kind]}
            </h2>
            <p className="truncate text-xs text-zinc-500">{item.title}</p>
          </div>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-sm text-zinc-400 hover:bg-white/5"
            onClick={onClose}
            disabled={saving}
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {loading ? (
            <p className="text-sm text-zinc-500">Загрузка промпта…</p>
          ) : null}
          {err ? <p className="text-sm text-red-400">{err}</p> : null}

          {!loading && payload?.mode === "photo" ? (
            <label className="block text-xs text-zinc-400">
              Промпт фото (edit)
              <textarea
                className="mt-1 min-h-[220px] w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs leading-relaxed text-zinc-100"
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
              />
            </label>
          ) : null}

          {!loading &&
          payload?.kind === "lora_i2v" &&
          payload.mode !== "multi" ? (
            <div className="space-y-3">
              <label className="block text-xs text-zinc-400">
                Still (картинка)
                <textarea
                  className="mt-1 min-h-[120px] w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs leading-relaxed text-zinc-100"
                  value={stillPrompt}
                  onChange={(e) => setStillPrompt(e.target.value)}
                />
              </label>
              <label className="block text-xs text-zinc-400">
                I2V (движение)
                <textarea
                  className="mt-1 min-h-[120px] w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs leading-relaxed text-zinc-100"
                  value={i2vPrompt}
                  onChange={(e) => setI2vPrompt(e.target.value)}
                />
              </label>
            </div>
          ) : null}

          {!loading &&
          payload?.kind === "lora_i2v" &&
          payload.mode === "multi" ? (
            <div className="space-y-4">
              {shots.map((shot, idx) => (
                <div
                  key={shot.id || idx}
                  className="space-y-2 rounded-xl border border-zinc-800 p-3"
                >
                  <div className="text-xs font-medium text-peach">
                    Шот {idx + 1}
                    {shot.durationSec ? (
                      <span className="ml-2 font-normal text-zinc-500">
                        ~{shot.durationSec}с
                      </span>
                    ) : null}
                  </div>
                  <label className="block text-[11px] text-zinc-500">
                    Still
                    <textarea
                      className="mt-1 min-h-[90px] w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-100"
                      value={shot.stillPrompt || ""}
                      onChange={(e) => {
                        const next = [...shots];
                        next[idx] = { ...shot, stillPrompt: e.target.value };
                        setShots(next);
                      }}
                    />
                  </label>
                  <label className="block text-[11px] text-zinc-500">
                    I2V
                    <textarea
                      className="mt-1 min-h-[90px] w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-100"
                      value={shot.i2vPrompt || ""}
                      onChange={(e) => {
                        const next = [...shots];
                        next[idx] = { ...shot, i2vPrompt: e.target.value };
                        setShots(next);
                      }}
                    />
                  </label>
                </div>
              ))}
            </div>
          ) : null}

          {!loading && payload?.mode === "shots" ? (
            <div className="space-y-4">
              {shots.map((shot, idx) => (
                <label
                  key={shot.id || idx}
                  className="block space-y-1 rounded-xl border border-zinc-800 p-3 text-xs text-zinc-400"
                >
                  Шот {idx + 1}
                  {shot.durationSec ? (
                    <span className="ml-2 text-zinc-500">~{shot.durationSec}с</span>
                  ) : null}
                  <textarea
                    className="mt-1 min-h-[110px] w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-100"
                    value={shot.legoQuery || ""}
                    onChange={(e) => {
                      const next = [...shots];
                      next[idx] = { ...shot, legoQuery: e.target.value };
                      setShots(next);
                    }}
                  />
                </label>
              ))}
            </div>
          ) : null}

          {!loading &&
          (payload?.mode === "story" || payload?.mode === "raw") ? (
            <label className="block text-xs text-zinc-400">
              {payload.mode === "story" ? "Story / H3 промпт" : "Промпт (raw)"}
              <textarea
                className="mt-1 min-h-[260px] w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs leading-relaxed text-zinc-100"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </label>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          <button
            type="button"
            className="rounded-lg border border-zinc-600 px-3 py-1.5 text-xs text-zinc-300"
            onClick={onClose}
            disabled={saving}
          >
            Отмена
          </button>
          <button
            type="button"
            className="rounded-lg bg-peach px-4 py-1.5 text-xs font-medium text-zinc-950 disabled:opacity-40"
            disabled={loading || saving || !payload}
            onClick={() => void save()}
          >
            {saving ? "Сохраняю…" : "Сохранить в TG"}
          </button>
        </div>
      </div>
    </div>
  );
}
