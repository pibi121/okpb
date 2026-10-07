import {
  TG_PHOTO_PEACHES,
  TG_UNDRESS_PEACHES,
  TG_VIDEO_SEC_PEACHES,
  TG_VIDEO_MIN_SEC,
  TG_TOP_UP_PACKS,
  TG_PREMIUM,
  TG_PROMO,
  setPricingOverlay,
} from "@/lib/tg-pricing";

export type OpsPrices = {
  photo_undress: number;
  photo_pose: number;
  photo_actress: number;
  photo_lora: number;
  /** 🍑 per second — animate / story / premium */
  video_sec_animate: number;
  video_sec_story: number;
  video_sec_premium: number;
  /** Minimum billable seconds for any video */
  video_min_sec: number;
  lora_train: number;
  topup_try: number;
  topup_hot: number;
  topup_fire: number;
  topup_pro: number;
  first_video_discount_pct: number;
  /** Legacy keys kept so old overlays still merge cleanly */
  undress?: number;
  photo_basic?: number;
  video_animate?: number;
  video_story_5?: number;
  video_story_10?: number;
  video_story_15?: number;
  video_story_long?: number;
  video_premium_10?: number;
  video_premium_15?: number;
  video_ultra?: number;
  video_basic5?: number;
  video_popular?: number;
  video_premium?: number;
};

const DEFAULTS: OpsPrices = {
  photo_undress: TG_UNDRESS_PEACHES,
  photo_pose: TG_PHOTO_PEACHES.pose,
  photo_actress: TG_PHOTO_PEACHES.actress,
  photo_lora: TG_PHOTO_PEACHES.lora,
  video_sec_animate: TG_VIDEO_SEC_PEACHES.animate,
  video_sec_story: TG_VIDEO_SEC_PEACHES.story,
  video_sec_premium: TG_VIDEO_SEC_PEACHES.premium,
  video_min_sec: TG_VIDEO_MIN_SEC,
  lora_train: TG_PREMIUM.loraTrainPeaches,
  topup_try: TG_TOP_UP_PACKS[0].peaches,
  topup_hot: TG_TOP_UP_PACKS[1].peaches,
  topup_fire: TG_TOP_UP_PACKS[2].peaches,
  topup_pro: TG_TOP_UP_PACKS[3].peaches,
  first_video_discount_pct: TG_PROMO.firstVideoDiscountPct,
};

let overlay: Partial<OpsPrices> = {};
let loadedAt = 0;
const PRICE_TTL_MS = 5_000;

export function setPriceOverlay(json: string) {
  let parsed: Record<string, number> = {};
  try {
    parsed = JSON.parse(json || "{}") as Record<string, number>;
  } catch {
    parsed = {};
  }
  // Drop stale flat/bucket defaults so per-second rates apply.
  const STALE_DEFAULTS: Record<string, number> = {
    photo_basic: 54,
    video_basic5: 142,
    video_popular: 197,
    video_premium: 274,
    video_ultra: 384,
    video_animate: 202,
    video_story_5: 159,
    video_story_10: 221,
    video_story_15: 279,
    video_story_long: 430,
    video_premium_10: 307,
    video_premium_15: 369,
    lora_train: 1000,
  };
  for (const [k, v] of Object.entries(STALE_DEFAULTS)) {
    if (parsed[k] === v) delete parsed[k];
  }
  if (typeof parsed.photo_undress === "number" && parsed.undress === undefined) {
    parsed.undress = parsed.photo_undress;
  } else if (typeof parsed.undress === "number" && parsed.photo_undress === undefined) {
    parsed.photo_undress = parsed.undress;
  }
  setPricingOverlay(parsed);
  overlay = parsed as Partial<OpsPrices>;
  loadedAt = Date.now();
}

/**
 * Reload /ops/prices from DB into memory.
 * Needed because Railway runs bot poller and Next as separate processes —
 * admin save updates only the web process unless the bot refreshes.
 */
export async function ensurePriceOverlay(force = false): Promise<void> {
  if (!force && loadedAt > 0 && Date.now() - loadedAt < PRICE_TTL_MS) {
    return;
  }
  try {
    const { getOpsSettings } = await import("@/lib/ops/settings");
    const settings = await getOpsSettings();
    setPriceOverlay(settings.pricesJson || "{}");
  } catch (e) {
    console.warn(
      "[ops] ensurePriceOverlay:",
      e instanceof Error ? e.message : e,
    );
  }
}

export function getOpsPrices(): OpsPrices {
  const merged: OpsPrices = { ...DEFAULTS, ...overlay };
  if (overlay.photo_undress === undefined && typeof overlay.undress === "number") {
    merged.photo_undress = overlay.undress;
  }
  if (overlay.photo_pose === undefined && typeof overlay.photo_lora === "number") {
    merged.photo_pose = overlay.photo_lora;
  }
  return merged;
}

export const PRICE_FIELDS: { key: keyof OpsPrices; title: string }[] = [
  { key: "photo_undress", title: "1. Раздевание фото (фикс)" },
  { key: "photo_pose", title: "2. Фото по позам / шаблоны (фикс)" },
  { key: "photo_actress", title: "3. Фото с актрисой (фикс)" },
  { key: "photo_lora", title: "4. Фото со своей LoRA (фикс)" },
  { key: "video_sec_animate", title: "5. Оживление — ₽ за 1 сек" },
  { key: "video_sec_story", title: "6. Обычный шаблон видео — ₽ за 1 сек" },
  { key: "video_sec_premium", title: "7. Best / премиум видео — ₽ за 1 сек" },
  { key: "video_min_sec", title: "Мин. секунд к оплате (видео)" },
  { key: "lora_train", title: "8. Обучение LoRA (фикс)" },
  { key: "topup_try", title: "Пакет Try" },
  { key: "topup_hot", title: "Пакет Hot" },
  { key: "topup_fire", title: "Пакет Fire" },
  { key: "topup_pro", title: "Пакет Pro" },
  { key: "first_video_discount_pct", title: "Скидка на первое видео, %" },
];
