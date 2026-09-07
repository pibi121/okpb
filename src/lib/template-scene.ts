/**
 * Template scene hygiene: strip author identity (lookbook + LoRA triggers)
 * so templates store pose/action/location only. Consumer always re-attaches
 * the selected character at generate time.
 */
import { fieldsForGender, type Gender } from "@/lib/lookbook";

const LOOKBOOK_EN_PHRASES: string[] = (() => {
  const out = new Set<string>();
  for (const g of ["female", "male"] as Gender[]) {
    for (const field of fieldsForGender(g)) {
      for (const opt of field.options) {
        const en = (opt.en || "").trim().toLowerCase();
        if (en.length >= 4) out.add(en);
      }
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
})();

export type SanitizeSceneOpts = {
  /** Author character display names to strip (e.g. "Gellai Tomphy", "Аня"). */
  authorNames?: string[];
  /** LoRA trigger words to strip (e.g. "olh_person"). */
  authorTriggers?: string[];
  /** Extra free-text fallthrough if structured strip empties the prompt. */
  fallback?: string;
};

function cleanScene(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/^[,.;:\s]+/, "")
    .replace(/[,.;:\s]+$/, "")
    .trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Pull SCENE block / drop IDENTITY LOCK / PERSON / lookbook / LoRA triggers. */
export function sanitizeTemplateScenePrompt(
  stillPrompt: string,
  opts?: SanitizeSceneOpts,
): string {
  const raw = (stillPrompt || "").trim();
  if (!raw) return (opts?.fallback || "").trim();

  const sceneLabel = raw.match(
    /SCENE\s*\([^)]*\)\s*:\s*([\s\S]+?)(?=\s*Exactly \d+ people|\s*Exactly one person|\s*$)/i,
  );
  let scene = sceneLabel?.[1]?.trim() || "";

  if (!scene) {
    scene = raw
      .replace(/BODY LOCK[\s\S]*?(?=SCENE\b|$)/i, "")
      .replace(/IDENTITY LOCK[\s\S]*?(?=SCENE\b|$)/i, "")
      .replace(/PERSON_\d+\s+is[\s\S]*?(?:every frame|not visible)\.\s*/gi, "")
      .replace(/Exactly \d+ people[\s\S]*/i, "")
      .replace(/Exactly one person[\s\S]*/i, "")
      .replace(/SCENE\s*\([^)]*\)\s*:\s*/i, "")
      .replace(/^[^.]*\btrigger\b[^.]*\.\s*/i, "")
      .trim();
  }

  // Drop leading LoRA trigger tokens ("olh_person. ..." or "foo_bar, baz.")
  scene = scene.replace(
    /^(?:[a-z][a-z0-9_]{2,}(?:\s*,\s*[a-z][a-z0-9_]{2,})*\s*\.\s*)+/i,
    "",
  );

  for (const name of opts?.authorNames || []) {
    const n = name.trim();
    if (n.length < 2) continue;
    const re = new RegExp(`\\b${escapeRegExp(n)}\\b`, "gi");
    scene = scene.replace(re, "");
    scene = scene.replace(new RegExp(`\\[${escapeRegExp(n)}\\]`, "gi"), "");
  }
  for (const trig of opts?.authorTriggers || []) {
    const t = trig.trim();
    if (t.length < 2) continue;
    scene = scene.replace(new RegExp(`\\b${escapeRegExp(t)}\\b`, "gi"), "");
  }

  // Remove canned lookbook English fragments when they were baked into free text.
  for (const phrase of LOOKBOOK_EN_PHRASES) {
    scene = scene.replace(new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "gi"), "");
  }

  // Common identity leftovers
  scene = scene
    .replace(/\b(adult (wo)?man|keep this exact appearance[^.]*\.?)\b/gi, "")
    .replace(/\bPERSON_\d+\b/gi, "")
    .replace(/\(\s*,\s*/g, "(")
    .replace(/\s*,\s*\)/g, ")")
    .replace(/(,\s*){2,}/g, ", ")
    .replace(/\s{2,}/g, " ")
    .trim();

  const cleaned = cleanScene(scene);
  if (cleaned) return cleaned;
  const fb = (opts?.fallback || "").trim();
  if (fb && fb !== raw) return sanitizeTemplateScenePrompt(fb, { ...opts, fallback: "" });
  // Last resort: if still looks like a lock dump, refuse to keep identity text.
  if (/IDENTITY LOCK|PERSON_\d+|red hair|blonde hair|Keep this exact appearance/i.test(raw)) {
    return "photorealistic adult scene, match pose and setting only";
  }
  return cleanScene(raw) || "photorealistic adult scene";
}

/** @deprecated use sanitizeTemplateScenePrompt */
export function sceneFromTemplateStillPrompt(
  stillPrompt: string,
  beat?: string,
): string {
  return sanitizeTemplateScenePrompt(stillPrompt, { fallback: beat });
}

/** Strip [CharacterName] LEGO tokens and plain name leftovers from a video shot query. */
export function sanitizeVideoLegoQuery(
  legoQuery: string,
  authorNames: string[],
): string {
  let q = (legoQuery || "").trim();
  if (!q) return q;
  for (const name of authorNames) {
    const n = name.trim();
    if (n.length < 2) continue;
    const escaped = escapeRegExp(n);
    q = q.replace(new RegExp(`\\[${escaped}\\]`, "gi"), "");
    q = q.replace(new RegExp(`\\b${escaped}\\b`, "gi"), "");
  }
  // Drop empty brackets / leftover commas
  q = q
    .replace(/\[\s*\]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return q;
}

export function extractBracketNames(text: string): string[] {
  const names: string[] = [];
  const re = /\[([^\]:]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const inner = (m[1] || "").trim();
    // skip typed tabs like location:bedroom, pose ids with colon already excluded
    if (!inner || /^(location|pose|action|voice|camera|event|voiceover)\b/i.test(inner)) {
      continue;
    }
    // skip if looks like tab with type prefix handled elsewhere
    if (inner.includes(":")) continue;
    names.push(inner);
  }
  return names;
}
