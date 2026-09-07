import fs from "fs";
import path from "path";

let cachedGuide: string | null = null;

export function loadPromptKnowledge(): string {
  if (cachedGuide) return cachedGuide;
  const p = path.join(process.cwd(), "docs", "PROMPT_GUIDE_FLUX_MINIMAX.md");
  cachedGuide = fs.readFileSync(p, "utf-8");
  return cachedGuide;
}

/** Photo (Krea) — Flux/Klein rules from the guide. */
export function photoKnowledgeExcerpt(): string {
  const full = loadPromptKnowledge();
  const start = full.indexOf("## 0. Стек и роли");
  const end = full.indexOf("## 4. Minimax H3");
  if (start >= 0 && end > start) return full.slice(start, end).trim();
  return full.slice(0, 12000);
}

/** Video (MiniMax H3 I2VA). */
export function videoKnowledgeExcerpt(): string {
  const full = loadPromptKnowledge();
  const start = full.indexOf("## 4. Minimax H3");
  const end = full.indexOf("## 6. Чеклист");
  if (start >= 0 && end > start) return full.slice(start, end).trim();
  return full.slice(full.indexOf("## 4."), full.indexOf("## 6.")).trim();
}
