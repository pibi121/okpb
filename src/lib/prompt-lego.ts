/**
 * Server-side LEGO catalog load + Krea prompt compile (identity lock).
 */
import { readFileSync, statSync } from "fs";
import path from "path";
import { loadPromptTemplates } from "@/lib/prompt-templates";
import {
  assembleLockedStillPrompt,
  characterIdentityLock,
} from "@/lib/character-identity";
import {
  analyzeLegoTokens,
  buildLegoCatalog,
  buildVideoLegoCatalog,
  parseLegoQuery,
  type CompiledLegoKrea,
  type LegoCatalogItem,
  type LegoCharacterRef,
  type VideoLegoFile,
} from "@/lib/prompt-lego-core";

type LegoFile = {
  lighting: Array<Omit<LegoCatalogItem, "kind">>;
  events: Array<Omit<LegoCatalogItem, "kind">>;
  stylization: Array<Omit<LegoCatalogItem, "kind">>;
  body?: Array<Omit<LegoCatalogItem, "kind">>;
};

let legoCache: LegoFile | null = null;
let legoMtime = 0;
let videoLegoCache: VideoLegoFile | null = null;
let videoLegoMtime = 0;

const EMPTY_LEGO: LegoFile = {
  lighting: [],
  events: [],
  stylization: [],
  body: [],
};

const EMPTY_VIDEO_LEGO: VideoLegoFile = {
  poses: [],
  actions: [],
  voices: [],
  cameras: [],
};

function readPresetJson<T>(name: string, empty: T): T {
  const p = path.join(process.cwd(), "presets", name);
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      console.warn(`[prompt-lego] missing ${p} — using empty catalog`);
      return empty;
    }
    throw e;
  }
}

export function loadLegoFile(): LegoFile {
  const p = path.join(process.cwd(), "presets", "prompt_lego.json");
  let mtime = 0;
  try {
    mtime = statSync(p).mtimeMs;
  } catch {
    if (!legoCache) legoCache = EMPTY_LEGO;
    return legoCache;
  }
  if (legoCache && mtime && mtime === legoMtime) return legoCache;
  const raw = readPresetJson<LegoFile>("prompt_lego.json", EMPTY_LEGO);
  const keep = <T extends { enabled?: boolean }>(rows: T[] | undefined) =>
    (rows || []).filter((row) => row.enabled !== false);
  legoCache = {
    lighting: keep(raw.lighting),
    events: keep(raw.events),
    stylization: keep(raw.stylization),
    body: keep(raw.body),
  };
  legoMtime = mtime;
  return legoCache;
}

export function loadVideoLegoFile(): VideoLegoFile {
  const p = path.join(process.cwd(), "presets", "prompt_lego_video.json");
  let mtime = 0;
  try {
    mtime = statSync(p).mtimeMs;
  } catch {
    if (!videoLegoCache) videoLegoCache = EMPTY_VIDEO_LEGO;
    return videoLegoCache;
  }
  if (videoLegoCache && mtime && mtime === videoLegoMtime) return videoLegoCache;
  const raw = readPresetJson<VideoLegoFile>("prompt_lego_video.json", EMPTY_VIDEO_LEGO);
  videoLegoCache = {
    poses: raw.poses || [],
    actions: raw.actions || [],
    voices: raw.voices || [],
    cameras: raw.cameras || [],
  };
  videoLegoMtime = mtime;
  return videoLegoCache;
}

export function listLegoCatalog(characters: LegoCharacterRef[] = []): LegoCatalogItem[] {
  const file = loadLegoFile();
  const templates = loadPromptTemplates();
  return buildLegoCatalog({
    poses: templates.poses,
    lighting: file.lighting,
    events: file.events,
    stylization: file.stylization,
    body: file.body || [],
    characters,
  });
}

export function listVideoLegoCatalog(
  characters: LegoCharacterRef[] = [],
): LegoCatalogItem[] {
  return buildVideoLegoCatalog({
    videoLego: loadVideoLegoFile(),
    characters,
  });
}

export async function compileLegoToKreaPrompt(opts: {
  query: string;
  characters: LegoCharacterRef[];
  characterIds?: string[];
}): Promise<{ prompt: string; meta: CompiledLegoKrea }> {
  const catalog = listLegoCatalog(opts.characters);
  const tokens = parseLegoQuery(opts.query, catalog);
  const meta = analyzeLegoTokens(tokens, opts.characters, catalog);
  const ids =
    meta.characterIdsInOrder.length > 0
      ? meta.characterIdsInOrder
      : opts.characterIds || [];
  const ordered = ids.filter((id) => opts.characters.some((c) => c.id === id));
  const identity = await characterIdentityLock(ordered);
  const prompt = assembleLockedStillPrompt({
    identity,
    scene: meta.scene || opts.query.trim() || "photorealistic adult scene",
  });
  return { prompt, meta };
}

/** Scene / pose / light only — no identity lock (face comes from Krea person ref). */
export function stripLegoCharacterNames(
  query: string,
  names: string[],
): string {
  let q = query;
  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    q = q.replace(new RegExp(`\\[${escaped}\\]`, "gi"), "");
  }
  return q.replace(/\s{2,}/g, " ").trim();
}

export async function compileLegoSceneOnlyPrompt(opts: {
  query: string;
  characters: LegoCharacterRef[];
}): Promise<{ prompt: string; meta: CompiledLegoKrea }> {
  const catalog = listLegoCatalog(opts.characters);
  const stripped = stripLegoCharacterNames(
    opts.query,
    opts.characters.map((c) => c.name),
  );
  const tokens = parseLegoQuery(stripped, catalog);
  const sceneTokens = tokens.filter((t) => t.kind !== "character");
  const meta = analyzeLegoTokens(sceneTokens, opts.characters, catalog);
  const prompt =
    meta.scene?.trim() ||
    stripped.replace(/\[[^\]]+\]/g, " ").replace(/\s+/g, " ").trim() ||
    "photorealistic adult scene";
  return { prompt, meta };
}

export {
  LEGO_PLUS_MENU,
  LEGO_VIDEO_PLUS_MENU,
  LEGO_VIDEO_SECTIONED_KINDS,
  LEGO_VIDEO_EXTRAS,
  analyzeLegoTokens,
  buildVideoLegoCatalog,
  formatLegoTab,
  groupCatalogBySection,
  parseLegoQuery,
  suggestLegoTabs,
  type CompiledLegoKrea,
  type LegoCatalogItem,
  type LegoCharacterRef,
  type LegoKind,
  type LegoToken,
  type VideoLegoFile,
  type VideoLegoStaticItem,
} from "@/lib/prompt-lego-core";
