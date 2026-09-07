"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Score = "bad" | "mid" | "good";
type Group = "classroom" | "park" | "animate";
type Pipeline = "ref2v" | "i2v";

type Clip = {
  id: string;
  title: string;
  url: string;
  group: Group;
  pipeline: Pipeline;
  variantId: string;
  furryStrength: number | null;
  steps: number | null;
  durationSec: number | null;
  genSec: number | null;
  engine: string | null;
};

type ClipRating = {
  identity: Score | null;
  action: Score | null;
  audio: Score | null;
  picture: Score | null;
  genitals: Score | null;
  note?: string;
};

const SCORE_LABEL: Record<Score, string> = {
  bad: "Плохо",
  mid: "Средне",
  good: "Хорошо",
};

const DIMS: Array<{ key: keyof Omit<ClipRating, "note">; label: string }> = [
  { key: "identity", label: "Идентичность внешности" },
  { key: "action", label: "Действие" },
  { key: "audio", label: "Озвучка" },
  { key: "picture", label: "Качество картинки" },
  { key: "genitals", label: "Качество гениталий" },
];

const GROUP_META: Record<
  Group,
  { title: string; blurb: string; pipeline: string }
> = {
  classroom: {
    title: "Classroom · Quick Video",
    blurb: "Университет / парта. Пайплайн MiniMax Ref2V (референс-картинки → видео).",
    pipeline: "Ref2V",
  },
  park: {
    title: "Park Moscow · Quick Video",
    blurb: "Парк / компания / минет. Пайплайн MiniMax Ref2V.",
    pipeline: "Ref2V",
  },
  animate: {
    title: "Оживление фото из галереи",
    blurb: "Still → видео. Пайплайн MiniMax I2V (FL2VA / Eros на ImageToVideo).",
    pipeline: "I2V",
  },
};

function emptyRating(): ClipRating {
  return {
    identity: null,
    action: null,
    audio: null,
    picture: null,
    genitals: null,
    note: "",
  };
}

function formatGen(sec: number | null): string {
  if (sec == null || sec <= 0) return "—";
  if (sec > 900) return `~${Math.round(sec / 60)} мин (wall, возможен простой/флап)`;
  if (sec >= 60) return `${Math.floor(sec / 60)}м ${sec % 60}с`;
  return `${sec}с`;
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
      <div className="w-full text-xs text-zinc-600 sm:w-44">{label}</div>
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

export function ErosEvalBoard() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [ratings, setRatings] = useState<Record<string, ClipRating>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | Group>("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/peach/eros-eval");
        const data = (await res.json()) as {
          clips?: Clip[];
          ratings?: Record<string, ClipRating>;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (cancelled) return;
        setClips(data.clips || []);
        setRatings(data.ratings || {});
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "load failed");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveRating = useCallback(async (clipId: string, rating: ClipRating) => {
    setSavingId(clipId);
    setRatings((prev) => ({ ...prev, [clipId]: rating }));
    try {
      const res = await fetch("/api/peach/eros-eval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clipId, rating }),
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
  }, []);

  const visible = useMemo(
    () => (filter === "all" ? clips : clips.filter((c) => c.group === filter)),
    [clips, filter],
  );

  const progress = useMemo(() => {
    let done = 0;
    for (const c of clips) {
      const r = ratings[c.id];
      if (
        r &&
        r.identity &&
        r.action &&
        r.audio &&
        r.picture &&
        r.genitals
      ) {
        done += 1;
      }
    }
    return { done, total: clips.length };
  }, [clips, ratings]);

  if (loading) {
    return <p className="text-sm text-zinc-500">Загрузка клипов…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4">
        <p className="text-sm text-zinc-600">
          Оцени каждый ролик: <strong>плохо / средне / хорошо</strong> по четырём
          осям. Classroom и Park — это <strong>Ref2V</strong> (quick video по
          рефам). Оживление фото — <strong>I2V</strong>. Время генерации —
          wall-clock от создания записи до ready (при обрыве туннеля может быть
          завышено).
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ["all", "Все"],
              ["classroom", "Classroom"],
              ["park", "Park"],
              ["animate", "Оживление"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`rounded-full border px-3 py-1 text-xs ${
                filter === id
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-200 bg-white text-zinc-700"
              }`}
            >
              {label}
            </button>
          ))}
          <span className="ml-auto text-xs text-zinc-500">
            Оценено полностью: {progress.done} / {progress.total}
            {savingId ? " · сохраняю…" : ""}
          </span>
        </div>
        {error ? <p className="text-xs text-rose-600">{error}</p> : null}
      </div>

      {(["classroom", "park", "animate"] as Group[])
        .filter((g) => filter === "all" || filter === g)
        .map((group) => {
          const list = visible.filter((c) => c.group === group);
          if (!list.length) return null;
          const meta = GROUP_META[group];
          return (
            <section key={group} className="flex flex-col gap-3">
              <div>
                <h3 className="text-base font-medium">{meta.title}</h3>
                <p className="text-xs text-zinc-500">
                  {meta.blurb} · метка пайплайна:{" "}
                  <span className="font-medium text-zinc-700">{meta.pipeline}</span>
                </p>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                {list.map((clip) => {
                  const rating = ratings[clip.id] || emptyRating();
                  const complete = Boolean(
                    rating.identity &&
                      rating.action &&
                      rating.audio &&
                      rating.picture &&
                      rating.genitals,
                  );
                  return (
                    <article
                      key={clip.id}
                      className={`flex flex-col overflow-hidden rounded-2xl border bg-white ${
                        complete ? "border-emerald-200" : "border-zinc-200"
                      }`}
                    >
                      <div className="bg-zinc-950">
                        <video
                          src={clip.url}
                          controls
                          playsInline
                          preload="metadata"
                          className="mx-auto max-h-[420px] w-full object-contain"
                        />
                      </div>
                      <div className="flex flex-col gap-3 p-3">
                        <div>
                          <div className="text-sm font-medium leading-snug">
                            {clip.title}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-zinc-500">
                            <span className="rounded bg-zinc-100 px-1.5 py-0.5">
                              {clip.pipeline.toUpperCase()}
                            </span>
                            {clip.furryStrength != null ? (
                              <span className="rounded bg-zinc-100 px-1.5 py-0.5">
                                furry {clip.furryStrength}
                              </span>
                            ) : null}
                            {clip.steps != null ? (
                              <span className="rounded bg-zinc-100 px-1.5 py-0.5">
                                {clip.steps} steps
                              </span>
                            ) : null}
                            <span className="rounded bg-zinc-100 px-1.5 py-0.5">
                              gen {formatGen(clip.genSec)}
                            </span>
                            {clip.durationSec != null ? (
                              <span className="rounded bg-zinc-100 px-1.5 py-0.5">
                                clip {clip.durationSec}s
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex flex-col gap-2">
                          {DIMS.map((d) => (
                            <ScoreRow
                              key={d.key}
                              label={d.label}
                              value={rating[d.key]}
                              onChange={(v) =>
                                void saveRating(clip.id, {
                                  ...rating,
                                  [d.key]: v,
                                })
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
                                ...(prev[clip.id] || emptyRating()),
                                note: e.target.value,
                              },
                            }))
                          }
                          onBlur={() =>
                            void saveRating(clip.id, {
                              ...(ratings[clip.id] || emptyRating()),
                              note: (ratings[clip.id] || emptyRating()).note,
                            })
                          }
                          placeholder="Заметка (необязательно)"
                          rows={2}
                          className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-xs outline-none focus:border-zinc-400"
                        />
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
    </div>
  );
}
