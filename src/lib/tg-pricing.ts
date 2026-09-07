/** PeachBitch TG — pricing in 🍑 персиках (1 персик = 1 ₽ номинал).
 * Video: per-second rates (approved 2026-09-06). Photo / LoRA train stay flat.
 */

export const PEACH_RUB = 1;

/** Category defaults (overridable via /ops/prices). */
export const TG_PHOTO_PEACHES = {
  /** Studio actress / cast */
  actress: 61,
  /** User-trained LoRA */
  lora: 79,
  /** @deprecated alias — kept for old overlays */
  basic: 61,
  /** @deprecated alias */
  pose: 79,
} as const;

/**
 * Video price = ceil(billableSec × 🍑/sec).
 * billableSec = max(durationSec, TG_VIDEO_MIN_SEC).
 */
export const TG_VIDEO_MIN_SEC = 3;

export const TG_VIDEO_SEC_PEACHES = {
  /** Оживление фото (юзер задаёт длительность) */
  animate: 34,
  /** Обычные шаблоны / Story H3 */
  story: 25,
  /** Best / премиум / LoRA-поза */
  premium: 34,
} as const;

export type TgVideoSecTier = keyof typeof TG_VIDEO_SEC_PEACHES;

/**
 * @deprecated bucket table — kept so old overlays / code still resolve.
 * New charging uses TG_VIDEO_SEC_PEACHES via *Peaches(duration) helpers.
 */
export const TG_VIDEO_PEACHES = {
  animate: TG_VIDEO_SEC_PEACHES.animate * 6,
  story5: TG_VIDEO_SEC_PEACHES.story * 6,
  story10: TG_VIDEO_SEC_PEACHES.story * 10,
  story15: TG_VIDEO_SEC_PEACHES.story * 15,
  storyLong: TG_VIDEO_SEC_PEACHES.story * 20,
  premium6: TG_VIDEO_SEC_PEACHES.premium * 6,
  premium10: TG_VIDEO_SEC_PEACHES.premium * 10,
  premium15: TG_VIDEO_SEC_PEACHES.premium * 15,
  ultra: TG_VIDEO_SEC_PEACHES.premium * 20,
  basic5: TG_VIDEO_SEC_PEACHES.story * 6,
  popular: TG_VIDEO_SEC_PEACHES.story * 10,
  premium: TG_VIDEO_SEC_PEACHES.premium * 10,
} as const;

/** Quick top-up buttons in bot (1 🍑 = 1 ₽). Template prices are separate. */
export const TG_QUICK_TOPUP_AMOUNTS = [100, 300, 1000, 4000] as const;
export const TG_MIN_TOPUP_PEACHES = 100;

export const TG_TOP_UP_PACKS = [
  { id: "try", label: { ru: "Try", en: "Try" }, peaches: 109, bonusPct: 0 },
  { id: "hot", label: { ru: "Hot", en: "Hot" }, peaches: 329, bonusPct: 10 },
  { id: "fire", label: { ru: "Fire", en: "Fire" }, peaches: 659, bonusPct: 20 },
  { id: "pro", label: { ru: "Pro", en: "Pro" }, peaches: 1649, bonusPct: 30 },
] as const;

export const TG_PREMIUM = {
  loraTrainPeaches: 1120,
} as const;

export const TG_AFFILIATE = {
  commissionPct: 50,
  minPayoutUsdt: 30,
} as const;

/** Promos (approved 2026-09-01). */
export const TG_PROMO = {
  loraWelcomePhotos: 5,
  loraBonusWindowMin: 30,
  studioDailyFreePhotos: 1,
  firstVideoDiscountPct: 30,
} as const;

export type TgVideoTier = keyof typeof TG_VIDEO_PEACHES;
export type TgPhotoTier = keyof typeof TG_PHOTO_PEACHES;

let priceOverlay: Record<string, number> = {};

export function setPricingOverlay(raw: Record<string, number> | string) {
  if (typeof raw === "string") {
    try {
      priceOverlay = JSON.parse(raw || "{}") as Record<string, number>;
    } catch {
      priceOverlay = {};
    }
  } else {
    priceOverlay = raw;
  }
}

function ov(key: string, fallback: number): number {
  const n = priceOverlay[key];
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Read overlay with fallback keys (new → legacy). */
function ovAny(keys: string[], fallback: number): number {
  for (const k of keys) {
    const n = priceOverlay[k];
    if (typeof n === "number" && Number.isFinite(n) && n >= 0) return n;
  }
  return fallback;
}

export function videoMinBillableSec(): number {
  return Math.max(
    1,
    Math.round(ovAny(["video_min_sec"], TG_VIDEO_MIN_SEC)),
  );
}

export function videoSecRate(tier: TgVideoSecTier): number {
  const keys: Record<TgVideoSecTier, string[]> = {
    animate: ["video_sec_animate", "video_animate_sec"],
    story: ["video_sec_story", "video_story_sec"],
    premium: ["video_sec_premium", "video_premium_sec"],
  };
  return ovAny(keys[tier], TG_VIDEO_SEC_PEACHES[tier]);
}

/** Billable seconds (floor = min). */
export function billableVideoSec(durationSec: number): number {
  const sec = Math.max(1, Math.round(durationSec || videoMinBillableSec()));
  return Math.max(videoMinBillableSec(), sec);
}

/** Core formula: ceil(sec × rate), at least 1 🍑. */
export function videoPeachesForSec(
  tier: TgVideoSecTier,
  durationSec: number,
): number {
  const sec = billableVideoSec(durationSec);
  const rate = videoSecRate(tier);
  return Math.max(1, Math.ceil(sec * rate));
}

/** @deprecated prefer videoPeachesForSec — bucket lookup for legacy callers */
export function tgVideoPeaches(tier: TgVideoTier): number {
  const map: Record<string, string[]> = {
    animate: ["video_animate", "video_premium6"],
    story5: ["video_story_5", "video_basic5"],
    story10: ["video_story_10", "video_popular"],
    story15: ["video_story_15"],
    storyLong: ["video_story_long", "video_ultra"],
    premium6: ["video_premium_6", "video_animate", "video_premium6"],
    premium10: ["video_premium_10", "video_premium"],
    premium15: ["video_premium_15"],
    ultra: ["video_ultra"],
    basic5: ["video_basic5", "video_story_5"],
    popular: ["video_popular", "video_story_10"],
    premium: ["video_premium", "video_premium_10"],
  };
  const keys = map[tier] || [`video_${tier}`];
  return ovAny(keys, TG_VIDEO_PEACHES[tier]);
}

export function tgPhotoPeaches(tier: TgPhotoTier): number {
  if (tier === "actress" || tier === "basic") {
    return ovAny(["photo_actress", "photo_basic"], TG_PHOTO_PEACHES.actress);
  }
  if (tier === "lora" || tier === "pose") {
    return ovAny(["photo_lora", "photo_pose"], TG_PHOTO_PEACHES.lora);
  }
  return ov(`photo_${tier}`, TG_PHOTO_PEACHES[tier]);
}

export function photoActressPeaches(): number {
  return tgPhotoPeaches("actress");
}

export function photoLoraPeaches(): number {
  return tgPhotoPeaches("lora");
}

/** Оживление фото — ставка за секунду × длительность. */
export function animatePeaches(durationSec = 6): number {
  return videoPeachesForSec("animate", durationSec);
}

export function loraTrainPeaches(): number {
  return ovAny(["lora_train"], TG_PREMIUM.loraTrainPeaches);
}

/** Story H3 / обычный шаблон — за секунду. */
export function storyH3Peaches(durationSec: number): number {
  return videoPeachesForSec("story", durationSec);
}

/** Premium / best / LoRA-поза — за секунду. */
export function premiumVideoPeaches(durationSec: number): number {
  return videoPeachesForSec("premium", durationSec);
}

/** First paid video: −30% once per account. */
export function applyFirstVideoDiscount(
  peaches: number,
  alreadyUsed: boolean,
): { peaches: number; discountApplied: boolean } {
  if (alreadyUsed || peaches <= 0) {
    return { peaches, discountApplied: false };
  }
  const pct = ov("first_video_discount_pct", TG_PROMO.firstVideoDiscountPct);
  const discounted = Math.max(1, Math.round(peaches * (1 - pct / 100)));
  return { peaches: discounted, discountApplied: true };
}

/** Display helpers for crypto / Stars checkout (rate from env or default). */
export function peachesToRub(peaches: number): number {
  return peaches * PEACH_RUB;
}

export function peachesToUsdt(
  peaches: number,
  rubPerUsdt = Number(process.env.TG_RUB_PER_USDT || 80),
): number {
  if (rubPerUsdt <= 0) return 0;
  return Math.round((peaches / rubPerUsdt) * 100) / 100;
}

/** Telegram Stars — approximate; override via TG_STARS_PER_PEACH env. */
export function peachesToStars(
  peaches: number,
  starsPerPeach = Number(process.env.TG_STARS_PER_PEACH || 0.77),
): number {
  return Math.max(1, Math.ceil(peaches * starsPerPeach));
}

export function formatPeachPrice(peaches: number, locale: "ru" | "en"): string {
  const n = peaches.toLocaleString(locale === "ru" ? "ru-RU" : "en-US");
  return locale === "ru" ? `${n} 🍑` : `${n} peaches`;
}

/** Human line for video quote: "12 сек × 25 🍑 = 300 🍑". */
export function formatVideoSecQuote(
  tier: TgVideoSecTier,
  durationSec: number,
  locale: "ru" | "en" = "ru",
): string {
  const sec = billableVideoSec(durationSec);
  const rate = videoSecRate(tier);
  const total = videoPeachesForSec(tier, durationSec);
  if (locale === "en") {
    return `${sec}s × ${rate} = ${formatPeachPrice(total, "en")}`;
  }
  return `${sec} сек × ${rate} 🍑 = ${formatPeachPrice(total, "ru")}`;
}

/** @deprecated use balancePeaches */
export function rubToPeaches(rub: number): number {
  return Math.round(rub / PEACH_RUB);
}
