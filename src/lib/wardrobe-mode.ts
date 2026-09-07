/** Per-shot wardrobe flags for Krea stills. Clothing details come from the user note. */

export function effectivePokies(clothed: boolean, pokies: boolean) {
  return clothed && pokies;
}

/** Positive lock. Does not invent garments — those stay in SCENE / user note. */
export function wardrobePositive(clothed: boolean, pokies: boolean): string {
  if (!clothed) return "";
  if (effectivePokies(clothed, pokies)) {
    return "WARDROBE LOCK: fully dressed in the clothes described in the scene. Opaque fabric covering breasts and genitals. Hard nipples visibly poking through the clothing, pokies. No nudity, no bare breasts, no nipples outside the clothes.";
  }
  return "WARDROBE LOCK: fully dressed in the clothes described in the scene. Opaque fabric fully covering breasts, nipples and genitals. Nipples not visible through clothing. No nudity, no exposed breasts, no underboob, no see-through.";
}

/**
 * When clothed, replace the default Krea negative (which bans clothes).
 * Nude shots keep the graph default (clothes/bra/panties).
 */
export function wardrobeNegative(clothed: boolean, pokies: boolean): string | undefined {
  if (!clothed) return undefined;
  const base =
    "child, underage, extra people, extra woman, extra man, twins, clone, duplicate face, extra limbs, deformed hands, mosaic, censored, blurry, nude, naked, topless, bottomless, exposed breasts, underboob, pussy, penis, see-through, transparent clothes";
  if (effectivePokies(clothed, pokies)) return base;
  return `${base}, nipples, areola, pokies, nipple outline, erect nipples`;
}

export function clothedLlmRule(clothed: boolean, pokies: boolean): string {
  if (!clothed) return "";
  const pokiesLine = effectivePokies(clothed, pokies)
    ? "Keep clothes on. Hard nipples may poke through the fabric (pokies). Do not undress. Do not show bare breasts."
    : "Keep clothes on. Do not mention nipples, breasts exposed, or nudity. Fabric is opaque.";
  return `WARDROBE MODE: dressed. Use only the garments from USER WISHES. ${pokiesLine}`;
}
