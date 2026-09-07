"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Score = "bad" | "mid" | "good";

type Clip = {
  id: string;
  batchId?: string;
  poseId?: string;
  itemId?: string;
  poseTitle?: string;
  itemTitle?: string;
  brick: string;
  variant: 1 | 2;
  url: string;
  status: string;
  durationSec: number | null;
  genSec: number | null;
  engine: string | null;
  error?: string | null;
  evalHintRu?: string;
  evalType?: string;
  comboType?: string;
  bricks?: Array<{
    category: string;
    categoryLabelRu?: string;
    id: string;
    title: string;
  }>;
  ratingCategories?: Array<{ key: string; labelRu: string }>;
};

type PoseMeta = {
  id: string;
  title: string;
  brick: string;
  evalHintRu?: string;
  bricks?: Clip["bricks"];
  ratingCategories?: Clip["ratingCategories"];
};

type ClipRating = {
  identity: Score | null;
  picture: Score | null;
  poseFit?: Score | null;
  actionFit?: Score | null;
  baseFit?: Score | null;
  addonFit?: Score | null;
  categoryFits?: Record<string, Score | null>;
  note?: string;
};

type GroupRating = {
  pickBest: "1" | "2" | null;
  promote?: boolean;
};

type BatchInfo = {
  id: string;
  label: string;
  meta: {
    status?: string;
    startedAt?: string | null;
    finishedAt?: string | null;
    totalExpected?: number;
  };
  clips: Clip[];
  poses: PoseMeta[];
};

const SCORE_LABEL: Record<Score, string> = {
  bad: "Плохо",
  mid: "Средне",
  good: "Хорошо",
};


function formatGen(sec: number | null): string {
  if (sec == null || sec <= 0) return "—";
  if (sec >= 60) return `${Math.floor(sec / 60)}м ${sec % 60}с`;
  return `${sec}с`;
}

function emptyClipRating(): ClipRating {
  return { identity: null, picture: null, categoryFits: {} };
}

function clipItemId(c: Clip): string {
  return c.itemId || c.poseId || "";
}

function clipTitle(c: Clip): string {
  return c.itemTitle || c.poseTitle || clipItemId(c);
}

type RatingDim = { key: string; label: string };

function ratingDimsForClip(clip: Clip, batchId: string): RatingDim[] {
  const dims: RatingDim[] = [
    { key: "identity", label: "Внешность персонажа" },
  ];
  if (clip.ratingCategories?.length) {
    for (const cat of clip.ratingCategories) {
      dims.push({ key: cat.key, label: cat.labelRu });
    }
  } else if (batchId === "actions") {
    dims.push({ key: "actionFit", label: "Попадание: действие" });
  } else {
    dims.push({ key: "poseFit", label: "Попадание: поза" });
  }
  dims.push({ key: "picture", label: "Качество картинки" });
  return dims;
}

function getRatingValue(rating: ClipRating, key: string): Score | null {
  if (key === "identity" || key === "picture") {
    return rating[key as "identity" | "picture"] ?? null;
  }
  const legacy = rating[key as keyof ClipRating];
  if (legacy === "bad" || legacy === "mid" || legacy === "good") {
    return legacy;
  }
  return rating.categoryFits?.[key] ?? null;
}

function setRatingValue(rating: ClipRating, key: string, v: Score): ClipRating {
  if (key === "identity" || key === "picture") {
    return { ...rating, [key]: v };
  }
  if (key === "poseFit" || key === "actionFit" || key === "baseFit" || key === "addonFit") {
    return { ...rating, [key]: v, categoryFits: { ...rating.categoryFits, [key]: v } };
  }
  return {
    ...rating,
    categoryFits: { ...(rating.categoryFits || {}), [key]: v },
  };
}

function clipComplete(r: ClipRating | undefined, dims: RatingDim[]): boolean {
  if (!r?.identity || !r.picture) return false;
  for (const d of dims) {
    if (d.key === "identity" || d.key === "picture") continue;
    if (!getRatingValue(r, d.key)) return false;
  }
  return true;
}

function ScoreRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Score | null;
  onChange: (v: Score) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <div className="w-full text-xs text-zinc-600 sm:w-40">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {(["bad", "mid", "good"] as Score[]).map((s) => {
          const active = value === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => onChange(s)}
              className={`rounded-md border px-2.5 py-1 text-xs transition ${
                active
                  ? s === "good"
                    ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                    : s === "mid"
                      ? "border-amber-600 bg-amber-50 text-amber-900"
                      : "border-rose-600 bg-rose-50 text-rose-800"
                  : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300"
              }`}
            >
              {SCORE_LABEL[s]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PoseEvalBoard() {
  const [batches, setBatches] = useState<BatchInfo[]>([]);
  const [activeBatchId, setActiveBatchId] = useState("actions");
  const [ratings, setRatings] = useState<Record<string, ClipRating>>({});
  const [groupRatings, setGroupRatings] = useState<Record<string, GroupRating>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showUnratedOnly, setShowUnratedOnly] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/peach/pose-eval");
    const data = (await res.json()) as {
      batches?: BatchInfo[];
      ratings?: Record<string, ClipRating>;
      groupRatings?: Record<string, GroupRating>;
      error?: string;
    };
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    setBatches(data.batches || []);
    setRatings(data.ratings || {});
    setGroupRatings(data.groupRatings || {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "load failed");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    const t = setInterval(() => {
      void load().catch(() => {});
    }, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [load]);

  const saveClipRating = useCallback(
    async (clipId: string, rating: ClipRating) => {
      setSavingId(clipId);
      setRatings((prev) => ({ ...prev, [clipId]: rating }));
      try {
        const res = await fetch("/api/peach/pose-eval", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clipId, clipRating: rating }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || `HTTP ${res.status}`);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "save failed");
      } finally {
        setSavingId(null);
      }
    },
    [],
  );

  const saveGroupRating = useCallback(
    async (poseId: string, rating: GroupRating) => {
      setSavingId(poseId);
      setGroupRatings((prev) => ({ ...prev, [poseId]: rating }));
      try {
        const res = await fetch("/api/peach/pose-eval", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ poseId, groupRating: rating }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || `HTTP ${res.status}`);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "save failed");
      } finally {
        setSavingId(null);
      }
    },
    [],
  );

  const activeBatch =
    batches.find((b) => b.id === activeBatchId) || batches[0];
  const clips = activeBatch?.clips || [];
  const poses = activeBatch?.poses || [];
  const batchMeta = activeBatch?.meta || {};

  const poseGroups = useMemo(() => {
    const map = new Map<string, { meta: PoseMeta; clips: Clip[] }>();
    for (const p of poses) {
      map.set(p.id, { meta: p, clips: [] });
    }
    for (const c of clips) {
      const gid = clipItemId(c);
      const g = map.get(gid);
      if (g) g.clips.push(c);
      else {
        map.set(gid, {
          meta: {
            id: gid,
            title: clipTitle(c),
            brick: c.brick,
            evalHintRu: c.evalHintRu,
            bricks: c.bricks,
            ratingCategories: c.ratingCategories,
          },
          clips: [c],
        });
      }
    }
    for (const g of map.values()) {
      g.clips.sort((a, b) => a.variant - b.variant);
    }
    return [...map.values()];
  }, [poses, clips]);

  const visibleGroups = useMemo(() => {
    if (!showUnratedOnly) return poseGroups;
    return poseGroups.filter((g) => {
      const gr = groupRatings[g.meta.id];
      if (gr?.pickBest) return false;
      return g.clips.some((c) => {
        const dims = ratingDimsForClip(c, activeBatchId);
        return !clipComplete(ratings[c.id], dims);
      });
    });
  }, [poseGroups, showUnratedOnly, ratings, groupRatings, activeBatchId]);

  const progress = useMemo(() => {
    let done = 0;
    for (const c of clips) {
      const dims = ratingDimsForClip(c, activeBatchId);
      if (clipComplete(ratings[c.id], dims)) done += 1;
    }
    const ready = clips.filter((c) => c.status === "ready").length;
    return { done, total: clips.length, ready, expected: batchMeta.totalExpected || clips.length };
  }, [clips, ratings, batchMeta.totalExpected]);

  if (loading) {
    return <p className="text-sm text-zinc-500">Загрузка…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4">
        <p className="text-sm text-zinc-600">
          Батч:{" "}
          <span className="font-medium text-zinc-800">
            {batchMeta.status || "unknown"}
          </span>
          {batchMeta.startedAt ? (
            <>
              {" "}
              · старт {new Date(batchMeta.startedAt).toLocaleString("ru-RU")}
            </>
          ) : null}
          {batchMeta.finishedAt ? (
            <>
              {" "}
              · финиш {new Date(batchMeta.finishedAt).toLocaleString("ru-RU")}
            </>
          ) : null}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {batches.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setActiveBatchId(b.id)}
              className={`rounded-full border px-3 py-1 text-xs ${
                activeBatchId === b.id
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-200 bg-white text-zinc-700"
              }`}
            >
              {b.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowUnratedOnly((v) => !v)}
            className={`rounded-full border px-3 py-1 text-xs ${
              showUnratedOnly
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-200 bg-white text-zinc-700"
            }`}
          >
            {showUnratedOnly ? "Только неоценённые" : "Все позы"}
          </button>
          <span className="ml-auto text-xs text-zinc-500">
            Готово видео: {progress.ready} / {progress.expected} · оценено:{" "}
            {progress.done} / {progress.total}
            {savingId ? " · сохраняю…" : ""}
          </span>
        </div>
        {error ? <p className="text-xs text-rose-600">{error}</p> : null}
      </div>

      {visibleGroups.length === 0 ? (
        <p className="text-sm text-zinc-500">
          {clips.length === 0
            ? "Клипы ещё генерируются — страница обновится автоматически."
            : "Нет поз по фильтру."}
        </p>
      ) : null}

      {visibleGroups.map(({ meta, clips: groupClips }) => {
        const gr = groupRatings[meta.id] || {
          pickBest: null,
          promote: false,
        };
        const brick = meta.brick || groupClips[0]?.brick || "";
        const hint =
          meta.evalHintRu ||
          groupClips[0]?.evalHintRu ||
          "";
        const brickTags =
          meta.bricks ||
          groupClips[0]?.bricks ||
          [];
        return (
          <section
            key={meta.id}
            className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4"
          >
            <div>
              <h3 className="text-base font-medium">{meta.title}</h3>
              <p className="mt-1 text-xs text-zinc-500">{meta.id}</p>
              {hint ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-sm leading-relaxed text-amber-950 whitespace-pre-line">
                  {hint}
                </div>
              ) : null}
              {brickTags.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {brickTags.map((b) => (
                    <span
                      key={`${b.category}-${b.id}`}
                      className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-700"
                    >
                      {b.categoryLabelRu || b.category}: {b.title}
                    </span>
                  ))}
                </div>
              ) : null}
              {brick ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-zinc-600">
                    Кирпичик позы
                  </summary>
                  <p className="mt-1 rounded-lg bg-zinc-50 p-2 text-xs leading-relaxed text-zinc-700">
                    {brick}
                  </p>
                </details>
              ) : null}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {groupClips.map((clip) => {
                const rating = ratings[clip.id] || emptyClipRating();
                const dims = ratingDimsForClip(clip, activeBatchId);
                const complete = clipComplete(rating, dims);
                const isPicked = gr.pickBest === String(clip.variant);
                return (
                  <article
                    key={clip.id}
                    className={`flex flex-col overflow-hidden rounded-xl border ${
                      isPicked
                        ? "border-emerald-400 ring-1 ring-emerald-200"
                        : complete
                          ? "border-emerald-200"
                          : "border-zinc-200"
                    }`}
                  >
                    <div className="bg-zinc-950">
                      {clip.status === "ready" && clip.url ? (
                        <video
                          src={clip.url}
                          controls
                          playsInline
                          preload="metadata"
                          className="mx-auto max-h-[360px] w-full object-contain"
                        />
                      ) : clip.status === "error" ? (
                        <div className="flex min-h-[200px] items-center justify-center p-4 text-sm text-rose-400">
                          {clip.error || "Ошибка генерации"}
                        </div>
                      ) : (
                        <div className="flex min-h-[200px] items-center justify-center p-4 text-sm text-zinc-400">
                          Генерируется…
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 p-3">
                      <div className="text-sm font-medium">
                        Вариант {clip.variant}
                        {isPicked ? (
                          <span className="ml-2 text-xs text-emerald-700">
                            ★ лучший
                          </span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-1 text-[11px] text-zinc-500">
                        <span className="rounded bg-zinc-100 px-1.5 py-0.5">
                          gen {formatGen(clip.genSec)}
                        </span>
                        {clip.durationSec != null ? (
                          <span className="rounded bg-zinc-100 px-1.5 py-0.5">
                            {clip.durationSec}s
                          </span>
                        ) : null}
                        {clip.engine ? (
                          <span className="rounded bg-zinc-100 px-1.5 py-0.5">
                            {clip.engine}
                          </span>
                        ) : null}
                      </div>
                      {clip.status === "ready" ? (
                        <>
                          <div className="flex flex-col gap-2">
                            {dims.map((d) => (
                              <ScoreRow
                                key={d.key}
                                label={d.label}
                                value={getRatingValue(rating, d.key)}
                                onChange={(v) =>
                                  void saveClipRating(clip.id, setRatingValue(rating, d.key, v))
                                }
                              />
                            ))}
                          </div>
                          <textarea
                            value={rating.note || ""}
                            onChange={(e) =>
                              setRatings((prev) => ({
                                ...prev,
                                [clip.id]: {
                                  ...(prev[clip.id] || emptyClipRating()),
                                  note: e.target.value,
                                },
                              }))
                            }
                            onBlur={() =>
                              void saveClipRating(clip.id, {
                                ...(ratings[clip.id] || emptyClipRating()),
                              })
                            }
                            placeholder="Заметка"
                            rows={2}
                            className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-xs outline-none focus:border-zinc-400"
                          />
                        </>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>

            {groupClips.some((c) => c.status === "ready") ? (
              <div className="flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-3">
                <span className="text-xs text-zinc-600">Лучший вариант:</span>
                {([1, 2] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() =>
                      void saveGroupRating(meta.id, {
                        ...gr,
                        pickBest:
                          gr.pickBest === String(v)
                            ? null
                            : (String(v) as "1" | "2"),
                      })
                    }
                    className={`rounded-md border px-3 py-1 text-xs ${
                      gr.pickBest === String(v)
                        ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                        : "border-zinc-200 bg-white text-zinc-600"
                    }`}
                  >
                    {v === 1 ? "A" : "B"}
                  </button>
                ))}
                <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-zinc-700">
                  <input
                    type="checkbox"
                    checked={!!gr.promote}
                    onChange={(e) =>
                      void saveGroupRating(meta.id, {
                        ...gr,
                        promote: e.target.checked,
                      })
                    }
                    className="rounded"
                  />
                  Promote кирпич
                </label>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
