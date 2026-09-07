/**
 * Social wardrobe: partial clothing = only listed garments; rest nude.
 * Unlike photo-lab wardrobePositive (fully dressed), social allows mixed nude.
 */

export function socialWardrobePositive(
  clothed: boolean,
  wardrobeNote: string,
): string {
  if (!clothed) {
    return "WARDROBE: completely nude, naked, bare skin, no clothes, no lingerie, no bra, no panties, no dress, no shorts, no top.";
  }
  const note = wardrobeNote.trim();
  if (!note) {
    return "WARDROBE LOCK: fully dressed in ordinary clothes. Opaque fabric covering breasts and genitals. No nudity.";
  }
  return (
    `WARDROBE: she is wearing ONLY this: ${note}. ` +
    "Only the listed garments exist. Any body part not covered by those garments is nude and exposed. " +
    "Do not invent extra clothing, jackets, shoes, or accessories unless listed."
  );
}

export function socialWardrobeNegative(
  clothed: boolean,
  wardrobeNote: string,
): string | undefined {
  if (!clothed) {
    // Keep graph default NSFW negative (bans clothes) — return undefined
    return undefined;
  }
  const note = wardrobeNote.trim();
  if (!note) {
    return "child, underage, extra people, twins, clone, nude, naked, topless, bottomless, exposed breasts, pussy, penis, see-through";
  }
  // Partial clothes: allow nudity where unspecified; ban random extra garments
  return "child, underage, extra people, twins, clone, mosaic, censored, blurry, random jacket, random coat, hoodie not listed, jeans not listed";
}

/** When scene has no bed — fight Krea bedroom bias (common for thin/NSFW portraits). */
export function socialLocationNegative(scenePrompt: string): string {
  if (/\b(bed|bedroom|mattress|pillow|sheets|bedding)\b/i.test(scenePrompt)) {
    return "";
  }
  return "bed, bedroom, mattress, bed sheets, pillows, lying on bed, on a bed, bedroom interior";
}
