/**
 * PhotoTemplate animate prompts (TG «оживить» 4/7/12 сек).
 * MiniMax I2V clamp is 4–12s — funnel uses 4 instead of TZ’s 3.
 */
export const ANIMATE_DURATIONS_SEC = [4, 7, 12] as const;
export type AnimateDurationSec = (typeof ANIMATE_DURATIONS_SEC)[number];

export type PhotoAnimateConfig = {
  mode: "shared" | "per_duration";
  sharedPrompt: string;
  byDuration: Partial<Record<`${AnimateDurationSec}`, string>>;
  coverUrl: string;
};

export function emptyPhotoAnimateConfig(): PhotoAnimateConfig {
  return {
    mode: "shared",
    sharedPrompt: "",
    byDuration: {},
    coverUrl: "",
  };
}

export function parsePhotoAnimateConfig(raw?: string | null): PhotoAnimateConfig {
  const base = emptyPhotoAnimateConfig();
  if (!raw?.trim()) return base;
  try {
    const j = JSON.parse(raw) as Partial<PhotoAnimateConfig>;
    const mode = j.mode === "per_duration" ? "per_duration" : "shared";
    const byDuration: PhotoAnimateConfig["byDuration"] = {};
    const src = j.byDuration && typeof j.byDuration === "object" ? j.byDuration : {};
    for (const d of ANIMATE_DURATIONS_SEC) {
      const v = String((src as Record<string, unknown>)[String(d)] || "").trim();
      if (v) byDuration[String(d) as `${AnimateDurationSec}`] = v.slice(0, 4000);
    }
    // Migrate TZ 3s slot → 4s (MiniMax floor).
    if (!byDuration["4"]) {
      const legacy3 = String((src as Record<string, unknown>)["3"] || "").trim();
      if (legacy3) byDuration["4"] = legacy3.slice(0, 4000);
    }
    return {
      mode,
      sharedPrompt: String(j.sharedPrompt || "").trim().slice(0, 4000),
      byDuration,
      coverUrl: String(j.coverUrl || "").trim().slice(0, 500),
    };
  } catch {
    return base;
  }
}

export function serializePhotoAnimateConfig(cfg: PhotoAnimateConfig): string {
  return JSON.stringify({
    mode: cfg.mode === "per_duration" ? "per_duration" : "shared",
    sharedPrompt: (cfg.sharedPrompt || "").trim().slice(0, 4000),
    byDuration: cfg.byDuration || {},
    coverUrl: (cfg.coverUrl || "").trim().slice(0, 500),
  });
}

export function animatePromptForDuration(
  cfg: PhotoAnimateConfig,
  sec: number,
): string {
  if (cfg.mode === "per_duration") {
    const key = String(sec) as `${AnimateDurationSec}`;
    const hit = cfg.byDuration[key]?.trim();
    if (hit) return hit;
    // Legacy TZ stored 3s prompts before MiniMax min became 4s.
    if (sec === 4) {
      const legacy3 = (cfg.byDuration as Record<string, string>)["3"]?.trim();
      if (legacy3) return legacy3;
    }
  }
  return cfg.sharedPrompt.trim();
}

/** Video funnel button categories (ТЗ эмодзи). */
export const VIDEO_FUNNEL_CATEGORIES = [
  { id: "sex", emoji: "🍓", ru: "Секс", en: "Sex" },
  { id: "story", emoji: "🍿", ru: "Сюжет", en: "Story" },
  { id: "dialogue", emoji: "💬", ru: "Диалоги", en: "Dialogue" },
] as const;

export type VideoFunnelCategoryId =
  (typeof VIDEO_FUNNEL_CATEGORIES)[number]["id"];

const VIDEO_CAT_SET = new Set(
  VIDEO_FUNNEL_CATEGORIES.map((c) => c.id as string),
);

export function parseVideoFunnelCategories(
  raw?: string | null,
): VideoFunnelCategoryId[] {
  if (!raw?.trim()) return [];
  const out: VideoFunnelCategoryId[] = [];
  for (const part of raw.split(/[,|;]+/)) {
    const id = part.trim().toLowerCase();
    if (VIDEO_CAT_SET.has(id) && !out.includes(id as VideoFunnelCategoryId)) {
      out.push(id as VideoFunnelCategoryId);
    }
  }
  return out;
}

export function formatVideoFunnelCategories(ids: readonly string[]): string {
  return [...new Set(ids.map((i) => i.trim().toLowerCase()).filter((i) => VIDEO_CAT_SET.has(i)))].join(
    ",",
  );
}

/** Button label suffix from categories, e.g. " 🍓🍿" */
export function videoFunnelCategoryEmojis(raw?: string | null): string {
  const ids = parseVideoFunnelCategories(raw);
  if (!ids.length) return "";
  const emojis = ids
    .map((id) => VIDEO_FUNNEL_CATEGORIES.find((c) => c.id === id)?.emoji)
    .filter(Boolean);
  return emojis.length ? ` ${emojis.join("")}` : "";
}
