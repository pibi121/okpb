/** Peach mini-film project types + helpers. */

import {
  kreaStillSize,
  normalizeVideoOrientation,
  VIDEO_ORIENTATIONS,
  type VideoOrientationId,
} from "@/lib/video-orientation";

export type FilmMode = "studio" | "fast";
export type FilmStep =
  | "idea"
  | "script"
  | "storyboard"
  | "clips"
  | "stitch"
  | "done";
export type FilmStatus = "idle" | "busy" | "error";
/** @deprecated use VideoOrientationId — kept for compat */
export type FilmAspect = VideoOrientationId;

export type FilmSceneStatus =
  | "draft"
  | "still_pending"
  | "still_ready"
  | "still_error"
  | "clip_pending"
  | "clip_ready"
  | "clip_error";

export type FilmScene = {
  index: number;
  /** Short who/what/where (RU ok in UI; EN preferred for prompts) */
  synopsis: string;
  dialogue?: string;
  stillPrompt?: string;
  videoPrompt?: string;
  /** Catalog pose id for sex beats — verbatim template text in the still prompt */
  poseId?: string;
  stillItemId?: string;
  stillUrl?: string;
  clipItemId?: string;
  clipUrl?: string;
  status: FilmSceneStatus;
  error?: string;
};

export type FilmAspectSize = { width: number; height: number; label: string };

export const FILM_ASPECTS: Record<VideoOrientationId, FilmAspectSize> =
  Object.fromEntries(
    (Object.keys(VIDEO_ORIENTATIONS) as VideoOrientationId[]).map((id) => {
      const k = kreaStillSize(id);
      return [id, { width: k.width, height: k.height, label: k.label }];
    }),
  ) as Record<VideoOrientationId, FilmAspectSize>;

export function filmAspectSize(aspect: string | null | undefined): FilmAspectSize {
  const id = normalizeVideoOrientation(aspect, "3_4");
  return FILM_ASPECTS[id];
}

/** Rough credit costs from existing single-gen economics. */
export const PEACH_FILM_COST = {
  still: 40,
  clip: 80,
  stitch: 25,
  music: 35,
  script: 10,
} as const;

/** Rough wall-clock seconds per unit (GPU queue). */
export const PEACH_FILM_TIME_SEC = {
  still: 45,
  clip: 90,
  stitch: 40,
  music: 50,
  script: 25,
} as const;

export function clampSceneCount(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 4;
  return Math.min(8, Math.max(3, Math.round(n)));
}

export function parseJsonArray(raw: string | null | undefined): string[] {
  try {
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function parseScenes(raw: string | null | undefined): FilmScene[] {
  try {
    const v = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(v)) return [];
    return v.map((s, i) => {
      const row = (s || {}) as Partial<FilmScene>;
      return {
        index: typeof row.index === "number" ? row.index : i,
        synopsis: String(row.synopsis || ""),
        dialogue: row.dialogue ? String(row.dialogue) : undefined,
        stillPrompt: row.stillPrompt ? String(row.stillPrompt) : undefined,
        videoPrompt: row.videoPrompt ? String(row.videoPrompt) : undefined,
        poseId: row.poseId ? String(row.poseId) : undefined,
        stillItemId: row.stillItemId ? String(row.stillItemId) : undefined,
        stillUrl: row.stillUrl ? String(row.stillUrl) : undefined,
        clipItemId: row.clipItemId ? String(row.clipItemId) : undefined,
        clipUrl: row.clipUrl ? String(row.clipUrl) : undefined,
        status: (row.status as FilmSceneStatus) || "draft",
        error: row.error ? String(row.error) : undefined,
      };
    });
  } catch {
    return [];
  }
}

export function estimateFilmQuote(opts: {
  sceneCount: number;
  withMusic?: boolean;
}) {
  const n = clampSceneCount(opts.sceneCount);
  const credits =
    PEACH_FILM_COST.script +
    n * (PEACH_FILM_COST.still + PEACH_FILM_COST.clip) +
    PEACH_FILM_COST.stitch +
    (opts.withMusic ? PEACH_FILM_COST.music : 0);
  const seconds =
    PEACH_FILM_TIME_SEC.script +
    n * (PEACH_FILM_TIME_SEC.still + PEACH_FILM_TIME_SEC.clip) +
    PEACH_FILM_TIME_SEC.stitch +
    (opts.withMusic ? PEACH_FILM_TIME_SEC.music : 0);
  const minutes = Math.max(1, Math.round(seconds / 60));
  return {
    sceneCount: n,
    credits,
    estimateSec: seconds,
    estimateLabel: minutes < 60 ? `~${minutes} мин` : `~${(minutes / 60).toFixed(1)} ч`,
  };
}

export function newFilmSeed(): string {
  return String(Math.floor(Math.random() * 1e15));
}

export type PublicFilmProject = {
  id: string;
  mode: FilmMode;
  step: FilmStep;
  status: FilmStatus;
  title: string | null;
  idea: string;
  withDialogue: boolean;
  characterIds: string[];
  poseIds: string[];
  sceneCount: number | null;
  aspect: FilmAspect;
  styleId: string | null;
  seed: string | null;
  filmBible: string;
  scenes: FilmScene[];
  folderItemId: string | null;
  durationSec: number;
  withMusic: boolean;
  musicNote: string;
  error: string | null;
  quote: ReturnType<typeof estimateFilmQuote>;
  updatedAt: string;
};

export function toPublicFilm(row: {
  id: string;
  mode: string;
  step: string;
  status: string;
  title: string | null;
  idea: string;
  withDialogue: boolean;
  characterIdsJson: string;
  poseIdsJson: string;
  sceneCount: number | null;
  aspect: string;
  styleId: string | null;
  seed: string | null;
  filmBible: string;
  scenesJson: string;
  folderItemId: string | null;
  durationSec: number;
  withMusic: boolean;
  musicNote: string;
  error: string | null;
  updatedAt: Date;
}): PublicFilmProject {
  const scenes = parseScenes(row.scenesJson);
  const n = row.sceneCount ?? (scenes.length || 4);
  return {
    id: row.id,
    mode: row.mode === "fast" ? "fast" : "studio",
    step: row.step as FilmStep,
    status: row.status as FilmStatus,
    title: row.title,
    idea: row.idea,
    withDialogue: row.withDialogue,
    characterIds: parseJsonArray(row.characterIdsJson),
    poseIds: parseJsonArray(row.poseIdsJson),
    sceneCount: row.sceneCount,
    aspect: normalizeVideoOrientation(row.aspect, "3_4"),
    styleId: row.styleId,
    seed: row.seed,
    filmBible: row.filmBible,
    scenes,
    folderItemId: row.folderItemId,
    durationSec: row.durationSec,
    withMusic: row.withMusic,
    musicNote: row.musicNote,
    error: row.error,
    quote: estimateFilmQuote({ sceneCount: n, withMusic: row.withMusic }),
    updatedAt: row.updatedAt.toISOString(),
  };
}
