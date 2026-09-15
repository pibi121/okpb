/**
 * Strip identity hair locks from Minimax I2V prompts so still / <Picture 1>
 * appearance wins (no morphing hair color/length/style).
 */
export function scrubHairFromI2vPrompt(text: string): string {
  if (!text) return text;
  let s = text;

  const phrases: RegExp[] = [
    // Full "young woman with … hair …" blocks (keep trailing body/skin if after comma)
    /\byoung woman with long blue ombre hair in a side braid,?\s*/gi,
    /\byoung woman with long blue hair in a thick braid,?\s*/gi,
    /\byoung woman with long blue hair in a braid,?\s*/gi,
    /\byoung woman with long black hair and\s+/gi,
    /\byoung woman with long black hair,?\s*/gi,
    /\byoung woman with long red hair,?\s*/gi,
    /\byoung woman with dark shoulder-length hair,?\s*/gi,
    /\byoung woman with dark brown hair,?\s*/gi,
    /\byoung woman with shoulder-length wavy light gray hair,?\s*/gi,
    /\bthe young woman with long blue ombre hair in a side braid,?\s*/gi,
    /\bthe young woman with long blue hair in a thick braid,?\s*/gi,
    /\bthe young woman with long blue hair in a braid,?\s*/gi,
    /\bthe young woman with long black hair and\s+/gi,
    /\bthe young woman with long black hair,?\s*/gi,
    /\bthe young woman with long red hair,?\s*/gi,
    /\bthe young woman with dark shoulder-length hair,?\s*/gi,
    /\bthe young woman with dark brown hair,?\s*/gi,
    /\bthe young woman with shoulder-length wavy light gray hair,?\s*/gi,
    // Male hair
    /\band the man with short light brown hair\b/gi,
    /\bthe man with short light brown hair\b/gi,
    /\bman with short light brown hair\b/gi,
    // Standalone hair clauses
    /\blong blue ombre hair in a side braid,?\s*/gi,
    /\blong blue hair in a thick braid,?\s*/gi,
    /\blong blue hair in a braid,?\s*/gi,
    /\blong black hair,?\s*/gi,
    /\blong red hair,?\s*/gi,
    /\bdark shoulder-length hair,?\s*/gi,
    /\bdark brown hair,?\s*/gi,
    /\bshoulder-length wavy light gray hair,?\s*/gi,
    /\bshort light brown hair,?\s*/gi,
    // Trailing identity locks that restate hair color/style
    /\bIdentity,\s*blue hair and braid,?\s*/gi,
    /\bIdentity,\s*blue hair,?\s*/gi,
    /\bIdentity,\s*[^,]{0,40}\bhair\b[^,]{0,40},?\s*/gi,
    // Generic: with <adj…> hair [in a braid/ponytail]
    /\bwith\s+(?:(?:long|short|shoulder-length|medium-length|wavy|straight|curly|thick|thin|dark|light|blue|brown|black|red|blonde|blond|gray|grey|ombre|auburn|ginger)\s+)+hair(?:\s+in\s+a\s+(?:side\s+|thick\s+)?(?:braid|ponytail|bun))?,?\s*/gi,
  ];

  for (const re of phrases) {
    s = s.replace(re, " ");
  }

  // After stripping "with … hair,", restore "with" before leftover body/skin attrs
  s = s.replace(/\byoung woman\s+(freckled|slim|large|bare|pale)/gi, "young woman with $1");
  s = s.replace(/\bthe young woman\s+(freckled|slim|large|bare|pale)/gi, "the young woman with $1");

  // Grammar cleanup
  s = s.replace(/\bthe young woman\s+and the man\b/gi, "the young woman and the man");
  s = s.replace(/\byoung woman\s+and the man\b/gi, "young woman and the man");
  s = s.replace(/\s{2,}/g, " ");
  s = s.replace(/\s+,/g, ",");
  s = s.replace(/,\s*,+/g, ",");
  s = s.replace(/:\s+/g, ": ");
  s = s.replace(/\s+\./g, ".");
  s = s.replace(/\(\s+/g, "(");
  s = s.replace(/\s+\)/g, ")");

  return s.trim();
}

export function scrubHairChanged(before: string, after: string): boolean {
  return before.trim() !== after.trim();
}
