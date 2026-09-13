/**
 * Catalog / charge prices — always from /ops/prices formulas.
 * Stored template.pricePeaches is display cache only; never overrides charge.
 */
import { parseStoryH3Template } from "@/lib/story-h3-prompt";
import { billableDurationSecForLoraI2v } from "@/lib/lora-i2v-shots";
import {
  photoActressPeaches,
  photoLoraPeaches,
  premiumVideoPeaches,
  storyH3Peaches,
} from "@/lib/tg-pricing";

export function priceForPhotoTemplateTier(
  tier: string | null | undefined,
): number {
  const t = (tier || "basic").toLowerCase();
  if (t === "pose" || t === "lora") return Math.max(1, photoLoraPeaches());
  return Math.max(1, photoActressPeaches());
}

/** Photo charge: studio cast → actress rate; own LoRA → lora rate. */
export function priceForPhotoCharacter(opts: {
  isStudioCast: boolean;
}): number {
  return Math.max(
    1,
    opts.isStudioCast ? photoActressPeaches() : photoLoraPeaches(),
  );
}

/**
 * Quick / story video: Story H3 → story 🍑/sec; LEGO/other → premium 🍑/sec.
 * If shotsJson is missing, use fallbackTier (default story — typical TG catalog).
 */
export function priceForQuickVideoTemplate(opts: {
  shotsJson?: string | null;
  durationSec?: number | null;
  fallbackTier?: "story" | "premium";
}): number {
  const story = opts.shotsJson
    ? parseStoryH3Template(opts.shotsJson)
    : null;
  const durationSec =
    story?.totalDurationSec ||
    Math.max(1, Math.round(Number(opts.durationSec) || 10));
  if (story) return Math.max(1, storyH3Peaches(durationSec));
  if (opts.shotsJson) return Math.max(1, premiumVideoPeaches(durationSec));
  if (opts.fallbackTier === "premium") {
    return Math.max(1, premiumVideoPeaches(durationSec));
  }
  return Math.max(1, storyH3Peaches(durationSec));
}

/** LoRA→I2V / best templates — premium 🍑/sec × billable duration. */
export function priceForLoraI2vTemplate(
  durationSec?: number | null,
  opts?: { shotsJson?: string | null },
): number {
  const billable = billableDurationSecForLoraI2v({
    durationSec,
    shotsJson: opts?.shotsJson,
  });
  return Math.max(1, premiumVideoPeaches(billable));
}
