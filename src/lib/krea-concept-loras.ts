/**
 * Krea2 concept / pose / slider LoRAs — matched from LEGO tabs, pose ids, aliases.
 * Files live under ComfyUI/models/loras/ (see presets/krea_concept_loras.json).
 */
import { readFileSync, statSync } from "fs";
import path from "path";

export type KreaConceptLoraSpec = {
  name: string;
  strength: number;
  strengthClip: number;
  id: string;
  label: string;
};

export type KreaConceptResolveResult = {
  loras: KreaConceptLoraSpec[];
  triggers: string[];
  promptBoosts: string[];
  matchedIds: string[];
};

type MatchBlock = {
  tabIds?: string[];
  poseIds?: string[];
  aliases?: string[];
};

type SliderVariant = {
  strength: number;
  tabIds?: string[];
  aliases?: string[];
  promptBoost?: string;
};

type LoraEntry = {
  id: string;
  file: string;
  label: string;
  enabled?: boolean;
  type?: "slider" | "concept";
  defaultStrength?: number;
  strengthClip?: number;
  triggers?: string[];
  promptBoost?: string;
  priority?: number;
  mutexGroup?: string | null;
  match?: MatchBlock;
  variants?: Record<string, SliderVariant>;
};

type RegistryFile = {
  maxExtraLoras?: number;
  mutexGroups?: Record<string, string[]>;
  loras: LoraEntry[];
};

let cache: RegistryFile | null = null;
let cacheMtime = 0;

const EMPTY_REGISTRY: RegistryFile = { maxExtraLoras: 4, loras: [] };

function loadRegistry(): RegistryFile {
  const p = path.join(process.cwd(), "presets", "krea_concept_loras.json");
  let mtime = 0;
  try {
    mtime = statSync(p).mtimeMs;
  } catch {
    if (!cache) {
      console.warn(
        `[krea-concept-loras] missing ${p} — using empty registry (no concept LoRAs)`,
      );
      cache = EMPTY_REGISTRY;
      cacheMtime = 0;
    }
    return cache;
  }
  if (cache && mtime && mtime === cacheMtime) return cache;
  cache = JSON.parse(readFileSync(p, "utf8")) as RegistryFile;
  cacheMtime = mtime;
  return cache;
}

function norm(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function haystack(...parts: Array<string | null | undefined>) {
  return norm(parts.filter(Boolean).join("\n"));
}

function aliasHit(hay: string, aliases: string[] | undefined): boolean {
  if (!aliases?.length || !hay) return false;
  for (const a of aliases) {
    const n = norm(a);
    if (n.length < 3) continue;
    if (hay.includes(n)) return true;
  }
  return false;
}

type Hit = {
  entry: LoraEntry;
  strength: number;
  strengthClip: number;
  promptBoost: string;
  triggers: string[];
  priority: number;
  variantKey?: string;
};

function collectHits(opts: {
  poseId?: string | null;
  tabIds?: string[];
  query?: string | null;
  scene?: string | null;
}): Hit[] {
  const reg = loadRegistry();
  const tabs = new Set((opts.tabIds || []).map(norm));
  const pose = opts.poseId ? norm(opts.poseId) : "";
  const hay = haystack(opts.query, opts.scene);
  const hits: Hit[] = [];

  for (const entry of reg.loras) {
    if (entry.enabled === false) continue;
    const clip =
      typeof entry.strengthClip === "number" ? entry.strengthClip : entry.defaultStrength ?? 0.8;
    const priority = entry.priority ?? 10;

    if (entry.type === "slider" && entry.variants) {
      let best: { key: string; v: SliderVariant; score: number } | null = null;
      for (const [key, v] of Object.entries(entry.variants)) {
        let score = 0;
        for (const tid of v.tabIds || []) {
          if (tabs.has(norm(tid))) score = Math.max(score, 100);
        }
        if (aliasHit(hay, v.aliases)) score = Math.max(score, 60);
        if (score > 0 && (!best || score > best.score)) best = { key, v, score };
      }
      if (best) {
        hits.push({
          entry,
          strength: best.v.strength,
          strengthClip: clip,
          promptBoost: best.v.promptBoost || "",
          triggers: entry.triggers || [],
          priority,
          variantKey: best.key,
        });
      }
      continue;
    }

    const m = entry.match || {};
    let score = 0;
    for (const tid of m.tabIds || []) {
      if (tabs.has(norm(tid))) score = Math.max(score, 100);
    }
    for (const pid of m.poseIds || []) {
      if (pose && norm(pid) === pose) score = Math.max(score, 95);
    }
    if (aliasHit(hay, m.aliases)) score = Math.max(score, 55);
    if (score <= 0) continue;

    hits.push({
      entry,
      strength: entry.defaultStrength ?? 0.8,
      strengthClip: clip,
      promptBoost: entry.promptBoost || "",
      triggers: entry.triggers || [],
      priority,
    });
  }

  return hits;
}

/**
 * Resolve concept LoRAs for a Krea still from LEGO tabs / pose / free text.
 * Applies mutex groups (keep highest priority) and maxExtraLoras cap.
 */
export function resolveKreaConceptLoras(opts: {
  poseId?: string | null;
  tabIds?: string[];
  query?: string | null;
  scene?: string | null;
}): KreaConceptResolveResult {
  const reg = loadRegistry();
  const max = reg.maxExtraLoras ?? 4;
  const hits = collectHits(opts).sort((a, b) => b.priority - a.priority);

  const usedMutex = new Set<string>();
  const picked: Hit[] = [];
  for (const h of hits) {
    const g = h.entry.mutexGroup;
    if (g && usedMutex.has(g)) continue;
    if (g) usedMutex.add(g);
    picked.push(h);
    if (picked.length >= max) break;
  }

  const loras: KreaConceptLoraSpec[] = picked.map((h) => ({
    id: h.entry.id,
    label: h.variantKey ? `${h.entry.label}:${h.variantKey}` : h.entry.label,
    name: h.entry.file,
    strength: h.strength,
    strengthClip: h.strengthClip,
  }));

  const triggers: string[] = [];
  const promptBoosts: string[] = [];
  for (const h of picked) {
    for (const t of h.triggers) {
      if (t && !triggers.some((x) => norm(x) === norm(t))) triggers.push(t);
    }
    if (h.promptBoost.trim()) promptBoosts.push(h.promptBoost.trim());
  }

  return {
    loras,
    triggers,
    promptBoosts,
    matchedIds: picked.map((h) =>
      h.variantKey ? `${h.entry.id}:${h.variantKey}` : h.entry.id,
    ),
  };
}

/** Inject trigger tokens at the start of a still prompt (after identity block if present). */
export function injectKreaConceptTriggers(
  prompt: string,
  triggers: string[],
  boosts: string[],
): string {
  const bits = [...triggers, ...boosts].filter(Boolean);
  if (!bits.length) return prompt;
  const extra = bits.join(", ");
  const text = prompt.trim();
  if (!text) return extra;
  // Avoid duplicating boost fragments already in the scene
  const lower = text.toLowerCase();
  const fresh = bits.filter((b) => !lower.includes(b.toLowerCase()));
  if (!fresh.length) return text;
  const join = fresh.join(", ");
  if (/SCENE\s*\(/i.test(text)) {
    return text.replace(/(SCENE\s*\([^)]*\):\s*)/i, `$1${join}, `);
  }
  if (/IDENTITY LOCK/i.test(text)) {
    return `${text}\nCONCEPT: ${join}`;
  }
  return `${join}. ${text}`;
}

export function listKreaConceptLoraFiles(): string[] {
  return loadRegistry().loras.map((l) => l.file);
}
