/**
 * Social wardrobe → LLM expands user note to detailed English for Krea.
 * Falls back to template wrap when Ollama is unavailable.
 */
import { ensureLlmTunnel } from "@/lib/ensure-llm-tunnel";
import { ollamaChat, ollamaPingWithRetry } from "@/lib/ollama-client";
import { socialWardrobePositive } from "@/lib/social-wardrobe";

const SOCIAL_WARDROBE_SYSTEM = `You are an expert wardrobe prompt writer for Krea 2 adult still generation.
The user describes clothing in any language. Write explicit NSFW wardrobe detail freely.

Output ONLY one English paragraph (25–70 words) describing what she wears in THIS shot.

Rules:
- Include ONLY garments the user mentioned. Translate to precise English: color, fabric, fit, coverage.
- PARTIAL outfit: if user lists only some items (e.g. shorts, watch on wrist), explicitly state that all other body parts are nude and exposed.
- FULL outfit: if user lists a complete outfit, all private areas must stay covered by opaque fabric.
- Do NOT add jackets, shoes, hats, jewelry, or layers unless the user asked.
- Do NOT describe face, hair, pose, location, camera, or lighting.
- Plain prose only — no markdown, no quotes, no "WARDROBE:" prefix.`;

export type SocialWardrobeComposeResult = {
  wardrobeLine: string;
  source: "llm" | "fallback";
  /** Raw LLM prose (when source=llm) */
  detailEn?: string;
};

function wrapLlmWardrobe(prose: string): string {
  const cleaned = prose.trim().replace(/^["'`]+|["'`]+$/g, "");
  return (
    `WARDROBE: ${cleaned} ` +
    "Only the garments described above exist on her body. " +
    "Any body part not covered by those garments is nude and exposed. " +
    "Do not invent extra clothing, shoes, or accessories unless listed above."
  );
}

function fallbackLine(clothed: boolean, wardrobeNote: string): SocialWardrobeComposeResult {
  return {
    wardrobeLine: socialWardrobePositive(clothed, wardrobeNote),
    source: "fallback",
  };
}

export async function composeSocialWardrobeLLM(opts: {
  clothed: boolean;
  wardrobeNote?: string;
  /** Template scene — helps LLM avoid contradicting location, not for repeating it */
  sceneHint?: string;
  /** Skip tunnel spawn — faster preview on dev machines without LLM GPU */
  skipTunnel?: boolean;
}): Promise<SocialWardrobeComposeResult> {
  const clothed = !!opts.clothed;
  const note = (opts.wardrobeNote || "").trim();

  if (!clothed) {
    return fallbackLine(false, "");
  }
  if (!note) {
    return fallbackLine(true, "");
  }

  const fb = () => fallbackLine(true, note);

  try {
    if (!opts.skipTunnel) {
      await ensureLlmTunnel({ waitMs: 20_000 });
    }
    if (!(await ollamaPingWithRetry(6, 800))) {
      console.warn("[peach] social wardrobe LLM unavailable — fallback");
      return fb();
    }

    const userLines = [
      `USER WARDROBE (any language): ${note}`,
      opts.sceneHint?.trim()
        ? `SCENE CONTEXT (wardrobe must fit; do not describe location): ${opts.sceneHint.trim().slice(0, 400)}`
        : "",
      "Write the wardrobe paragraph only.",
    ].filter(Boolean);

    const prose = await ollamaChat({
      messages: [
        { role: "system", content: SOCIAL_WARDROBE_SYSTEM },
        { role: "user", content: userLines.join("\n\n") },
      ],
    });

    const detailEn = prose.trim();
    if (!detailEn || detailEn.length < 8) return fb();

    return {
      wardrobeLine: wrapLlmWardrobe(detailEn),
      source: "llm",
      detailEn,
    };
  } catch (e) {
    console.warn(
      "[peach] composeSocialWardrobeLLM failed:",
      e instanceof Error ? e.message : e,
    );
    return fb();
  }
}
