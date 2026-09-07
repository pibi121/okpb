/** Location comes from the user note. Pose/style catalogs must not invent a bedroom. */

const WANTS_BED =
  /\b(bed|bedroom|mattress|pillow|sheets|кровать|спален|простын|постел)/i;

const OUTDOOR =
  /\b(park|forest|woods|tree|trees|grass|ground|dirt|soil|trail|path|outdoor|outside|street|alley|yard|garden|meadow|field|парк|лес|дерев|трава|земл|улиц|тропинка|на улице|на земле|поляна)/i;

export function wantsBedLocation(userNote?: string): boolean {
  return WANTS_BED.test(userNote || "");
}

export function isOutdoorLocation(userNote?: string): boolean {
  return OUTDOOR.test(userNote || "");
}

export function locationLlmRule(userNote?: string): string {
  const outdoor = isOutdoorLocation(userNote);
  return [
    "LOCATION LOCK: place the scene ONLY where USER WISHES says.",
    "Pose words like bed, floor, pillow are body geometry — put bodies on the scene surface (grass, dirt, path, ground, tree).",
    "Never add a bed, bedroom, mattress, pillows, headboard, or messy sheets unless USER WISHES names a bed or bedroom.",
    outdoor
      ? "USER WISHES is outdoors — outdoor lighting of that place. No indoor bedroom, no bedside lamp, no sheets."
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Ban bedroom furniture unless the note explicitly asks for a bed/bedroom. */
export function locationFurnitureNegative(userNote?: string): string {
  if (wantsBedLocation(userNote)) return "";
  return "bed, bedroom, mattress, pillows, headboard, duvet, messy sheets, nightstand, indoor bedroom, bedside lamp, lying on bed";
}

export function allowIndoorBedroomStyle(userNote?: string, styleId?: string): boolean {
  if (!styleId) return true;
  if (!/bedroom/i.test(styleId)) return true;
  if (wantsBedLocation(userNote)) return true;
  if (isOutdoorLocation(userNote)) return false;
  return true;
}

/** Strip catalog furniture so pose is body geometry only. */
export function poseGeometryOnly(text: string): string {
  return text
    .replace(/\bon the edge of the bed\b/gi, "")
    .replace(/\bon the bed\b/gi, "")
    .replace(/\bagainst the bed\b/gi, "")
    .replace(/\bpressed flat against the bed\b/gi, "pressed flat")
    .replace(/\binto the pillow\b/gi, "")
    .replace(/\bon the pillow\b/gi, "")
    .replace(/\bin the pillow\b/gi, "")
    .replace(/\bthe pillow\b/gi, "")
    .replace(/\bthe mattress\b/gi, "the ground")
    .replace(/\bon the floor\b/gi, "on the ground")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .trim();
}
