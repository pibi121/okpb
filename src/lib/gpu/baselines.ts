/** Service-level SLO baselines (wait + run). Overridable via OpsSetting.sloJson. */

export type FunctionSlo = {
  key: string;
  title: string;
  pool: "photo" | "video" | "lora" | "any";
  /** Max acceptable queue wait before red. */
  waitMs: number;
  /** Expected GPU work time (your current timings). */
  runMs: number;
};

/** Defaults: keep current UX timings; red when wait grows. */
export const DEFAULT_FUNCTION_SLOS: FunctionSlo[] = [
  {
    key: "photo_actress",
    title: "1. Фото актриса",
    pool: "photo",
    waitMs: 60_000,
    runMs: 90_000,
  },
  {
    key: "photo_lora",
    title: "2. Фото своя LoRA",
    pool: "photo",
    waitMs: 60_000,
    runMs: 120_000,
  },
  {
    key: "video_animate",
    title: "3. Оживление фото",
    pool: "video",
    waitMs: 120_000,
    runMs: 12 * 60_000,
  },
  {
    key: "video_story",
    title: "4. Стори H3",
    pool: "video",
    waitMs: 120_000,
    runMs: 15 * 60_000,
  },
  {
    key: "video_premium",
    title: "5. Премиум / LoRA-поза",
    pool: "video",
    waitMs: 120_000,
    runMs: 18 * 60_000,
  },
  {
    key: "lora_train",
    title: "6. Обучение LoRA",
    pool: "lora",
    waitMs: 10 * 60_000,
    runMs: 120 * 60_000,
  },
];

export function mergeSlos(raw: string | Record<string, unknown> | null | undefined): FunctionSlo[] {
  let overlay: Record<string, Partial<FunctionSlo>> = {};
  if (typeof raw === "string" && raw.trim()) {
    try {
      overlay = JSON.parse(raw) as Record<string, Partial<FunctionSlo>>;
    } catch {
      overlay = {};
    }
  } else if (raw && typeof raw === "object") {
    overlay = raw as Record<string, Partial<FunctionSlo>>;
  }
  return DEFAULT_FUNCTION_SLOS.map((d) => {
    const o = overlay[d.key] || {};
    return {
      ...d,
      waitMs: typeof o.waitMs === "number" && o.waitMs > 0 ? o.waitMs : d.waitMs,
      runMs: typeof o.runMs === "number" && o.runMs > 0 ? o.runMs : d.runMs,
      title: typeof o.title === "string" && o.title ? o.title : d.title,
    };
  });
}

export function sloForKind(kind: string): FunctionSlo {
  const k = kind.toLowerCase();
  if (k.includes("train") || k === "lora") {
    return DEFAULT_FUNCTION_SLOS.find((s) => s.key === "lora_train")!;
  }
  if (k.includes("i2v") || k.includes("premium") || k.includes("pose")) {
    return DEFAULT_FUNCTION_SLOS.find((s) => s.key === "video_premium")!;
  }
  if (k.includes("story") || k.includes("quick") || k === "video" || k === "clip" || k === "film") {
    return DEFAULT_FUNCTION_SLOS.find((s) => s.key === "video_story")!;
  }
  if (k.includes("animate")) {
    return DEFAULT_FUNCTION_SLOS.find((s) => s.key === "video_animate")!;
  }
  if (k.includes("lora") && k.includes("photo")) {
    return DEFAULT_FUNCTION_SLOS.find((s) => s.key === "photo_lora")!;
  }
  return DEFAULT_FUNCTION_SLOS.find((s) => s.key === "photo_actress")!;
}

export type HealthLevel = "ok" | "warn" | "danger";

export function ratioHealth(actual: number, baseline: number): HealthLevel {
  if (!baseline || actual <= 0) return "ok";
  const r = actual / baseline;
  if (r >= 1.5) return "danger";
  if (r >= 1.2) return "warn";
  return "ok";
}
