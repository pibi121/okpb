"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  VIDEO_FUNNEL_CATEGORIES,
  parseVideoFunnelCategories,
  formatVideoFunnelCategories,
  type VideoFunnelCategoryId,
} from "@/lib/photo-template-animate";

type Kind = "photo" | "video" | "lora_i2v";

type TransferItem = {
  kind: Kind;
  id: string;
  title: string;
  notes: string;
  displayTitle: string;
  funnelV2Published: boolean;
  sceneCategory: string;
  previewImageUrl: string;
  previewVideoUrl: string;
  sortOrder: number;
  durationSec: number;
  updatedAt: string;
  labHref: string;
  requiresLora?: boolean;
};

type Draft = {
  funnelV2Published: boolean;
  displayTitle: string;
  notes: string;
  sceneCategory: string;
  previewImageUrl: string;
  previewVideoUrl: string;
};

const TABS: Array<{ id: Kind; label: string; hint: string }> = [
  {
    id: "photo",
    label: "Фото (позы)",
    hint: "Identity Edit · по 1 фото",
  },
  {
    id: "video",
    label: "Видео · MiniMax",
    hint: "Story H3 · по 1 фото",
  },
  {
    id: "lora_i2v",
    label: "Видео · Krea→MiniMax",
    hint: "только без LoRA · по 1 фото",
  },
];

function draftFromItem(it: TransferItem): Draft {
  return {
    funnelV2Published: it.funnelV2Published,
    displayTitle: it.displayTitle || "",
    notes: it.notes || "",
    sceneCategory: it.sceneCategory || "",
    previewImageUrl: it.previewImageUrl || "",
    previewVideoUrl: it.previewVideoUrl || "",
  };
}

function draftKey(kind: Kind, id: string) {
  return `${kind}:${id}`;
}

function isDirty(base: Draft, cur: Draft): boolean {
  return (
    base.funnelV2Published !== cur.funnelV2Published ||
    base.displayTitle.trim() !== cur.displayTitle.trim() ||
    base.notes.trim() !== cur.notes.trim() ||
    formatVideoFunnelCategories(parseVideoFunnelCategories(base.sceneCategory)) !==
      formatVideoFunnelCategories(parseVideoFunnelCategories(cur.sceneCategory)) ||
    base.previewImageUrl !== cur.previewImageUrl ||
    base.previewVideoUrl !== cur.previewVideoUrl
  );
}

export function Lab2TransferClient() {
  const [tab, setTab] = useState<Kind>("photo");
  const [lists, setLists] = useState<Record<Kind, TransferItem[]>>({
    photo: [],
    video: [],
    lora_i2v: [],
  });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [baseline, setBaseline] = useState<Record<string, Draft>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [uploadBusy, setUploadBusy] = useState("");
  const [orderDirty, setOrderDirty] = useState<Record<Kind, boolean>>({
    photo: false,
    video: false,
    lora_i2v: false,
  });
  const [dragId, setDragId] = useState<string | null>(null);

  const hydrate = useCallback((data: {
    photo: TransferItem[];
    video: TransferItem[];
    lora_i2v: TransferItem[];
  }) => {
    setLists({
      photo: data.photo || [],
      video: data.video || [],
      lora_i2v: data.lora_i2v || [],
    });
    const nextDrafts: Record<string, Draft> = {};
    const nextBase: Record<string, Draft> = {};
    for (const kind of ["photo", "video", "lora_i2v"] as Kind[]) {
      for (const it of data[kind] || []) {
        const k = draftKey(kind, it.id);
        const d = draftFromItem(it);
        nextDrafts[k] = d;
        nextBase[k] = { ...d };
      }
    }
    setDrafts(nextDrafts);
    setBaseline(nextBase);
    setOrderDirty({ photo: false, video: false, lora_i2v: false });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    setOkMsg("");
    try {
      const res = await fetch("/api/peach/lab2-transfer");
      if (!res.ok) {
        setErr("Не удалось загрузить шаблоны");
        return;
      }
      const data = (await res.json()) as {
        photo: TransferItem[];
        video: TransferItem[];
        lora_i2v: TransferItem[];
      };
      hydrate(data);
    } catch {
      setErr("Сеть");
    } finally {
      setLoading(false);
    }
  }, [hydrate]);

  useEffect(() => {
    void load();
  }, [load]);

  const items = lists[tab];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) => {
      const d = drafts[draftKey(it.kind, it.id)];
      const hay = `${it.title} ${d?.displayTitle || ""} ${d?.notes || ""} ${it.id}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [items, q, drafts]);

  const dirtyCount = useMemo(() => {
    let n = 0;
    for (const [k, d] of Object.entries(drafts)) {
      const b = baseline[k];
      if (b && isDirty(b, d)) n += 1;
    }
    for (const kind of ["photo", "video", "lora_i2v"] as Kind[]) {
      if (orderDirty[kind]) n += 1;
    }
    return n;
  }, [drafts, baseline, orderDirty]);

  const publishedOnTab = useMemo(
    () =>
      items.filter((it) => drafts[draftKey(it.kind, it.id)]?.funnelV2Published)
        .length,
    [items, drafts],
  );

  const canDrag = !q.trim();

  const reorder = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setLists((prev) => {
      const arr = [...prev[tab]];
      const from = arr.findIndex((x) => x.id === fromId);
      const to = arr.findIndex((x) => x.id === toId);
      if (from < 0 || to < 0) return prev;
      const [row] = arr.splice(from, 1);
      arr.splice(to, 0, row!);
      return { ...prev, [tab]: arr };
    });
    setOrderDirty((prev) => ({ ...prev, [tab]: true }));
    setOkMsg("");
  };

  const setDraft = (kind: Kind, id: string, patch: Partial<Draft>) => {
    const k = draftKey(kind, id);
    setDrafts((prev) => ({
      ...prev,
      [k]: { ...(prev[k] || draftFromItem(items.find((x) => x.id === id)!)), ...patch },
    }));
    setOkMsg("");
  };

  const toggleCat = (kind: Kind, id: string, cat: VideoFunnelCategoryId) => {
    const k = draftKey(kind, id);
    const cur = parseVideoFunnelCategories(drafts[k]?.sceneCategory || "");
    const next = cur.includes(cat)
      ? cur.filter((c) => c !== cat)
      : [...cur, cat];
    setDraft(kind, id, {
      sceneCategory: formatVideoFunnelCategories(next),
    });
  };

  const uploadPreview = async (
    kind: Kind,
    id: string,
    slot: "image" | "video",
    file: File,
  ) => {
    const busy = `${kind}:${id}:${slot}`;
    setUploadBusy(busy);
    setErr("");
    try {
      const form = new FormData();
      form.set("kind", kind);
      form.set("id", id);
      form.set("slot", slot);
      form.set("file", file);
      const res = await fetch("/api/peach/lab2-transfer/preview", {
        method: "POST",
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        url?: string;
        error?: string;
      };
      if (!res.ok || !data.url) {
        setErr(data.error || "Не удалось загрузить превью");
        return;
      }
      setDraft(
        kind,
        id,
        slot === "video"
          ? { previewVideoUrl: data.url }
          : { previewImageUrl: data.url },
      );
      setBaseline((prev) => {
        const k = draftKey(kind, id);
        const cur = prev[k];
        if (!cur) return prev;
        return {
          ...prev,
          [k]: {
            ...cur,
            ...(slot === "video"
              ? { previewVideoUrl: data.url! }
              : { previewImageUrl: data.url! }),
          },
        };
      });
    } catch {
      setErr("Сеть при загрузке превью");
    } finally {
      setUploadBusy("");
    }
  };

  const saveAll = async () => {
    const payload: Array<{
      kind: Kind;
      id: string;
      funnelV2Published?: boolean;
      displayTitle?: string;
      notes?: string;
      sceneCategory?: string;
      previewImageUrl?: string;
      previewVideoUrl?: string;
      sortOrder?: number;
    }> = [];
    const seen = new Set<string>();

    for (const kind of ["photo", "video", "lora_i2v"] as Kind[]) {
      for (const it of lists[kind]) {
        const k = draftKey(kind, it.id);
        const d = drafts[k];
        const b = baseline[k];
        const metaDirty = Boolean(d && b && isDirty(b, d));
        const ordDirty = orderDirty[kind];
        if (!metaDirty && !ordDirty) continue;
        const idx = lists[kind].findIndex((x) => x.id === it.id);
        const row: (typeof payload)[number] = {
          kind,
          id: it.id,
        };
        if (metaDirty && d) {
          row.funnelV2Published = d.funnelV2Published;
          row.displayTitle = d.displayTitle.trim();
          row.notes = d.notes.trim();
          row.sceneCategory = d.sceneCategory;
          row.previewImageUrl = d.previewImageUrl;
          row.previewVideoUrl = d.previewVideoUrl;
        }
        if (ordDirty && idx >= 0) row.sortOrder = idx;
        if (seen.has(k)) continue;
        seen.add(k);
        payload.push(row);
      }
    }

    if (!payload.length) {
      setOkMsg("Нет изменений");
      return;
    }

    setSaving(true);
    setErr("");
    setOkMsg("");
    try {
      const res = await fetch("/api/peach/lab2-transfer", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: payload }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        saved?: number;
        failed?: Array<{ id: string; error?: string }>;
        error?: string;
      };
      if (!res.ok) {
        setErr(data.error || "Не удалось сохранить");
        return;
      }
      if (data.failed?.length) {
        setErr(
          `Сохранено ${data.saved || 0}, ошибок: ${data.failed
            .map((f) => f.error || f.id)
            .join("; ")}`,
        );
      } else {
        setOkMsg(`Сохранено: ${data.saved || payload.length}`);
      }
      await load();
    } catch {
      setErr("Сеть");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-peach/80">
            Lab 2.0
          </p>
          <h1 className="mt-1 text-xl font-medium text-foreground">
            Перенос в новую воронку (бот)
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">
            Только Funnel v2 · по 1 фото. Галочка не трогает старую воронку и
            Mini App (для них будет отдельный раздел). LoRA-шаблоны сюда не
            попадают.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-white/15 px-3 py-2 text-xs text-zinc-300"
            onClick={() => void load()}
            disabled={loading || saving}
          >
            Обновить
          </button>
          <button
            type="button"
            className="rounded-lg bg-peach px-4 py-2 text-xs font-medium text-zinc-950 disabled:opacity-40"
            disabled={saving || dirtyCount === 0}
            onClick={() => void saveAll()}
          >
            {saving
              ? "Сохраняю…"
              : dirtyCount
                ? `Сохранить (${dirtyCount})`
                : "Сохранить"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const count = lists[t.id].length;
          const on = lists[t.id].filter(
            (it) => drafts[draftKey(t.id, it.id)]?.funnelV2Published,
          ).length;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-2xl border px-3 py-2 text-left transition ${
                tab === t.id
                  ? "border-peach/50 bg-peach/10"
                  : "border-white/10 bg-[#121214]/80 hover:border-white/20"
              }`}
            >
              <div className="text-[13px] font-medium text-foreground">
                {t.label}
              </div>
              <div className="text-[11px] text-zinc-500">
                {t.hint} · в Funnel {on}/{count}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="min-w-[14rem] flex-1 rounded-lg border border-white/10 bg-[#121214] px-3 py-2 text-sm"
          placeholder="Поиск по названию / описанию…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="text-[12px] text-zinc-500">
          На вкладке в Funnel: {publishedOnTab}/{items.length}
          {dirtyCount ? ` · черновик ${dirtyCount}` : ""}
          {canDrag ? " · перетащи для порядка кнопок" : " · сбрось поиск, чтобы менять порядок"}
        </span>
      </div>

      {err ? <p className="text-sm text-red-400">{err}</p> : null}
      {okMsg ? <p className="text-sm text-emerald-400/90">{okMsg}</p> : null}
      {loading ? <p className="text-sm text-zinc-500">Загрузка…</p> : null}
      {!loading && filtered.length === 0 ? (
        <p className="text-sm text-zinc-500">
          Шаблонов нет. Создай в{" "}
          <Link
            href={
              tab === "photo"
                ? "/peach/photo-edit"
                : tab === "video"
                  ? "/peach/story-video"
                  : "/peach/lora-i2v"
            }
            className="text-peach underline"
          >
            лабе
          </Link>
          .
        </p>
      ) : null}

      <div className="grid gap-2">
        {filtered.map((it, index) => {
          const k = draftKey(it.kind, it.id);
          const d = drafts[k] || draftFromItem(it);
          const dirty = baseline[k] ? isDirty(baseline[k]!, d) : false;
          const open = expanded === k;
          const cats = parseVideoFunnelCategories(d.sceneCategory);
          const showCats = it.kind !== "photo";
          const thumb = d.previewImageUrl || d.previewVideoUrl;

          return (
            <article
              key={k}
              draggable={canDrag && !open}
              onDragStart={() => {
                if (!canDrag) return;
                setDragId(it.id);
              }}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => {
                if (!canDrag || !dragId) return;
                e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (!canDrag || !dragId) return;
                reorder(dragId, it.id);
                setDragId(null);
              }}
              className={`rounded-2xl border p-3 ${
                dirty || orderDirty[tab]
                  ? "border-peach/35 bg-peach/[0.04]"
                  : "border-white/10 bg-[#121214]/70"
              } ${dragId === it.id ? "opacity-60" : ""} ${
                canDrag && !open ? "cursor-grab active:cursor-grabbing" : ""
              }`}
            >
              <div className="flex items-start gap-3">
                {canDrag ? (
                  <span
                    className="mt-2 select-none text-[11px] text-zinc-600"
                    title="Перетащить"
                    aria-hidden
                  >
                    ⋮⋮
                  </span>
                ) : null}
                <span className="mt-2 w-5 shrink-0 text-center text-[11px] text-zinc-600">
                  {index + 1}
                </span>
                <label className="mt-1 flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[#f5a97f]"
                    checked={d.funnelV2Published}
                    onChange={(e) =>
                      setDraft(it.kind, it.id, {
                        funnelV2Published: e.target.checked,
                      })
                    }
                  />
                  <span className="sr-only">В воронку</span>
                </label>

                <div className="h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-zinc-900">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={d.previewImageUrl || thumb}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[9px] text-zinc-600">
                      нет
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-[14px] font-medium text-foreground">
                      {d.displayTitle.trim() || it.title}
                    </p>
                    {d.funnelV2Published ? (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">
                        в Funnel v2
                      </span>
                    ) : (
                      <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500">
                        скрыт
                      </span>
                    )}
                    {dirty ? (
                      <span className="rounded-full bg-peach/15 px-2 py-0.5 text-[10px] text-peach">
                        изменено
                      </span>
                    ) : null}
                    {it.durationSec > 0 ? (
                      <span className="text-[11px] text-zinc-500">
                        ~{it.durationSec}с
                      </span>
                    ) : null}
                    {showCats && cats.length > 0 ? (
                      <span className="text-[12px]">
                        {cats
                          .map(
                            (c) =>
                              VIDEO_FUNNEL_CATEGORIES.find((x) => x.id === c)
                                ?.emoji,
                          )
                          .join("")}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-[12px] text-zinc-500">
                    {it.title}
                    {d.notes ? ` · ${d.notes.slice(0, 80)}` : ""}
                  </p>
                </div>

                <button
                  type="button"
                  className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-zinc-300"
                  onClick={() => setExpanded(open ? null : k)}
                >
                  {open ? "Свернуть" : "Редактировать"}
                </button>
              </div>

              {open ? (
                <div className="mt-3 grid gap-3 border-t border-white/8 pt-3 sm:grid-cols-2">
                  <label className="block text-[11px] text-zinc-500">
                    Название в кнопке
                    <input
                      className="mt-1 w-full rounded-lg border border-white/10 bg-zinc-950 px-2.5 py-2 text-sm"
                      value={d.displayTitle}
                      placeholder={it.title}
                      onChange={(e) =>
                        setDraft(it.kind, it.id, {
                          displayTitle: e.target.value,
                        })
                      }
                    />
                  </label>

                  <label className="block text-[11px] text-zinc-500 sm:col-span-2">
                    Описание (в confirm бота)
                    <textarea
                      className="mt-1 min-h-[72px] w-full rounded-lg border border-white/10 bg-zinc-950 px-2.5 py-2 text-sm"
                      value={d.notes}
                      onChange={(e) =>
                        setDraft(it.kind, it.id, { notes: e.target.value })
                      }
                    />
                  </label>

                  {showCats ? (
                    <div className="sm:col-span-2">
                      <p className="text-[11px] text-zinc-500">
                        Категория видео (эмодзи на кнопке)
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {VIDEO_FUNNEL_CATEGORIES.map((c) => {
                          const on = cats.includes(c.id);
                          return (
                            <button
                              key={c.id}
                              type="button"
                              className={`rounded-full border px-3 py-1 text-xs ${
                                on
                                  ? "border-peach/50 bg-peach/15 text-peach"
                                  : "border-white/10 text-zinc-400"
                              }`}
                              onClick={() => toggleCat(it.kind, it.id, c.id)}
                            >
                              {c.emoji} {c.ru}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  <div>
                    <p className="text-[11px] text-zinc-500">Превью-картинка</p>
                    {d.previewImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={d.previewImageUrl}
                        alt=""
                        className="mt-1 h-28 w-20 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="mt-1 flex h-28 w-20 items-center justify-center rounded-lg bg-zinc-900 text-[10px] text-zinc-600">
                        нет
                      </div>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      className="mt-2 block w-full text-[11px] text-zinc-400"
                      disabled={!!uploadBusy}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadPreview(it.kind, it.id, "image", f);
                        e.target.value = "";
                      }}
                    />
                  </div>

                  <div>
                    <p className="text-[11px] text-zinc-500">
                      Превью-видео (тизер confirm)
                    </p>
                    {d.previewVideoUrl ? (
                      <video
                        src={d.previewVideoUrl}
                        className="mt-1 h-28 w-20 rounded-lg object-cover"
                        muted
                        playsInline
                        controls
                      />
                    ) : (
                      <div className="mt-1 flex h-28 w-20 items-center justify-center rounded-lg bg-zinc-900 text-[10px] text-zinc-600">
                        нет
                      </div>
                    )}
                    <input
                      type="file"
                      accept="video/*"
                      className="mt-2 block w-full text-[11px] text-zinc-400"
                      disabled={!!uploadBusy}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadPreview(it.kind, it.id, "video", f);
                        e.target.value = "";
                      }}
                    />
                  </div>

                  <div className="flex flex-wrap gap-2 sm:col-span-2">
                    <Link
                      href={it.labHref}
                      className="rounded-lg border border-white/10 px-3 py-1.5 text-[11px] text-zinc-300"
                    >
                      Открыть в лабе →
                    </Link>
                    {uploadBusy.startsWith(`${it.kind}:${it.id}`) ? (
                      <span className="text-[11px] text-zinc-500">
                        Загрузка превью…
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      <div className="sticky bottom-3 z-10 flex justify-end">
        <button
          type="button"
          className="rounded-xl bg-peach px-5 py-2.5 text-sm font-medium text-zinc-950 shadow-lg disabled:opacity-40"
          disabled={saving || dirtyCount === 0}
          onClick={() => void saveAll()}
        >
          {saving
            ? "Сохраняю…"
            : dirtyCount
              ? `Сохранить изменения (${dirtyCount})`
              : "Сохранить"}
        </button>
      </div>
    </div>
  );
}
