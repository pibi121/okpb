/**
 * Infer lookbook from character training photos via Ollama (vision if supported).
 */
import fs from "fs";
import path from "path";
import {
  emptyLookbook,
  fieldsForGender,
  toCustomValue,
  type Gender,
  type LookbookValues,
} from "@/lib/lookbook";
import { characterImagesDir, listCharacterPhotos } from "@/lib/character-dataset";
import { ollamaChat } from "@/lib/ollama-client";

function fieldCatalog(gender: Gender): string {
  return fieldsForGender(gender)
    .map((f) => {
      const opts = f.options.map((o) => `${o.id}=${o.en}`).join(" | ");
      return `- ${f.id} (${f.label}): presets=[${opts || "none"}]; prefer preset id OR use custom:"english phrase" for nuances (e.g. custom:"blonde hair with blue tips")`;
    })
    .join("\n");
}

function pickPhotoBuffers(characterId: string, max = 6): { name: string; b64: string }[] {
  const dir = characterImagesDir(characterId);
  const photos = listCharacterPhotos(characterId);
  const out: { name: string; b64: string }[] = [];
  for (const p of photos) {
    if (out.length >= max) break;
    const abs = path.join(dir, p.name);
    try {
      const st = fs.statSync(abs);
      if (st.size > 2_500_000) continue; // skip huge originals for LLM payload
      const buf = fs.readFileSync(abs);
      out.push({ name: p.name, b64: buf.toString("base64") });
    } catch {
      /* skip */
    }
  }
  return out;
}

function parseJsonObject(text: string): Record<string, string> {
  const cleaned = text.replace(/^```[\w]*\n?/i, "").replace(/\n?```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("LLM не вернул JSON lookbook");
  const raw = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

function normalizeInferred(
  gender: Gender,
  raw: Record<string, string>,
): LookbookValues {
  const base = emptyLookbook(gender);
  const fields = fieldsForGender(gender);
  for (const field of fields) {
    const v = raw[field.id];
    if (!v) continue;
    if (v.startsWith("custom:")) {
      base[field.id] = toCustomValue(v.slice("custom:".length));
      continue;
    }
    if (field.options.some((o) => o.id === v)) {
      base[field.id] = v;
      continue;
    }
    // free phrase without prefix
    base[field.id] = toCustomValue(v);
  }
  return base;
}

export async function inferLookbookFromPhotos(opts: {
  characterId: string;
  gender: Gender;
  name?: string;
}): Promise<LookbookValues> {
  const images = pickPhotoBuffers(opts.characterId, 6);
  if (images.length < 1) {
    throw new Error("Нет фото для анализа lookbook — загрузи хотя бы 1–5 фото");
  }

  const system = `You are an expert adult character appearance tagger for NSFW image generation.
Look at the reference photos of ONE consenting adult. Infer a lookbook JSON.
Rules:
- Output ONLY a single JSON object. No markdown, no commentary.
- Keys must be exactly the field ids listed.
- For each field: prefer a preset option id when it fits well.
- When appearance is nuanced (e.g. blonde with blue tips, freckles, tattoos), use custom:"short English phrase".
- Adults only. Never imply underage.
- If a body part is not visible, still make a best-effort guess consistent with the photos; for genital fields use a sensible default (shaved for female if unclear; medium_thick + trimmed for male if unclear).
- Gender of the character is ${opts.gender}.`;

  const userText = `Character name: ${opts.name || "unknown"}
Gender: ${opts.gender}
Fields:
${fieldCatalog(opts.gender)}

Return JSON like:
{"hair_color":"custom:blonde hair with blue tips","body":"avg_slim","genital_hair":"shaved","details":"custom:light freckles on cheeks"}`;

  let text: string;
  try {
    text = await ollamaChat({
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: userText + `\n(${images.length} reference photos attached)`,
          images: images.map((i) => i.b64),
        },
      ],
      numPredict: 700,
      temperature: 0.2,
      timeoutMs: 600_000,
    });
  } catch (e) {
    // Fallback without images if vision unsupported
    const msg = e instanceof Error ? e.message : String(e);
    if (!/vision|image|does not support|invalid/i.test(msg)) throw e;
    text = await ollamaChat({
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content:
            userText +
            `\nVision unavailable. Infer a coherent adult ${opts.gender} lookbook with plausible custom hair/details. Prefer varied realistic traits.`,
        },
      ],
      numPredict: 700,
      temperature: 0.35,
      timeoutMs: 480_000,
    });
  }

  return normalizeInferred(opts.gender, parseJsonObject(text));
}
