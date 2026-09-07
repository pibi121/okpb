import { readFileSync, statSync } from "fs";
import path from "path";

export type TemplatePose = {
  id: string;
  label: string;
  text: string;
  /** Base MiniMax I2V motion for this pose (Picture 1 lock + action) */
  videoMotion?: string;
};
export type TemplateStyle = { id: string; label: string; text: string };

type PromptPresetsFile = {
  poses: TemplatePose[];
  styles: TemplateStyle[];
};

let cache: PromptPresetsFile | null = null;
let cacheMtimeMs = 0;

const EMPTY_TEMPLATES: PromptPresetsFile = { poses: [], styles: [] };

export function clearPromptTemplateCache() {
  cache = null;
  cacheMtimeMs = 0;
}

export function loadPromptTemplates(): PromptPresetsFile {
  const p = path.join(process.cwd(), "presets", "prompt_presets.json");
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(p).mtimeMs;
  } catch {
    if (!cache) {
      console.warn(`[prompt-templates] missing ${p} — using empty catalog`);
      cache = EMPTY_TEMPLATES;
    }
    return cache;
  }
  if (cache && mtimeMs && mtimeMs === cacheMtimeMs) return cache;
  cache = JSON.parse(readFileSync(p, "utf-8")) as PromptPresetsFile;
  cacheMtimeMs = mtimeMs;
  return cache;
}

export function findPose(id: string): TemplatePose | undefined {
  return loadPromptTemplates().poses.find((p) => p.id === id);
}

export function findStyle(id: string): TemplateStyle | undefined {
  return loadPromptTemplates().styles.find((s) => s.id === id);
}

/** Sex poses from the catalog. */
export function listSexPoses(): TemplatePose[] {
  return loadPromptTemplates().poses;
}
