import fs from "node:fs";
import path from "node:path";

export type ComfyApiWorkflow = {
  prompt: Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  definitions?: unknown;
};

let cached: ComfyApiWorkflow | null = null;
let cachedMtime = 0;

export function loadRef2VAReadyApiWorkflow(): ComfyApiWorkflow {
  const p = path.join(
    process.cwd(),
    "workflows",
    "MiniMax_H3_Character_Ref2VA_READY.api.json",
  );
  const mtime = fs.statSync(p).mtimeMs;
  if (cached && cachedMtime === mtime) return cached;
  cached = JSON.parse(fs.readFileSync(p, "utf8")) as ComfyApiWorkflow;
  cachedMtime = mtime;
  return cached;
}

export function patchRef2VAReadyPrompt(
  base: ComfyApiWorkflow,
  opts: {
    characterImageName: string;
    drivingVideoName: string;
    scenePrompt?: string;
    motionPrompt?: string;
    sam3Target?: string;
    durationSec?: number;
    seed?: number;
    filenamePrefix: string;
    /** Override MiniMax output size (otherwise keep graph / GetImageSize links) */
    width?: number;
    height?: number;
  },
): { prompt: Record<string, unknown>; definitions?: unknown } {
  const prompt = structuredClone(base.prompt) as Record<
    string,
    { class_type: string; inputs: Record<string, unknown> }
  >;

  if (prompt["496"]) prompt["496"].inputs.image = opts.characterImageName;
  if (prompt["459"]) prompt["459"].inputs.file = opts.drivingVideoName;
  if (prompt["507"]?.inputs && opts.scenePrompt?.trim()) {
    prompt["507"].inputs.value = opts.scenePrompt.trim();
    delete prompt["507"].inputs.text;
  }
  if (prompt["509"]?.inputs && opts.motionPrompt?.trim()) {
    prompt["509"].inputs.value = opts.motionPrompt.trim();
    delete prompt["509"].inputs.text;
  }
  if (prompt["455_436"]?.inputs && opts.sam3Target?.trim()) {
    prompt["455_436"].inputs.text = opts.sam3Target.trim();
  } else if (prompt["455"]?.inputs && opts.sam3Target?.trim()) {
    prompt["455"].inputs.text = opts.sam3Target.trim();
  }
  if (prompt["480"]?.inputs && opts.durationSec) {
    prompt["480"].inputs.value = opts.durationSec;
  }
  if (prompt["467"]?.inputs) {
    prompt["467"].inputs.noise_seed =
      opts.seed ?? Math.floor(Math.random() * 1e15);
  }
  if (prompt["482"]?.inputs) {
    prompt["482"].inputs.filename_prefix = opts.filenamePrefix;
  }
  if (prompt["464"]?.inputs) {
    prompt["464"].inputs["ref_videos.ref_video_0"] = ["456", 0];
    const pr = prompt["464"].inputs.prompt;
    if (Array.isArray(pr) && pr[0] === "517") {
      prompt["464"].inputs.prompt = ["514", 0];
    }
    if (opts.width && opts.height) {
      prompt["464"].inputs.width = opts.width;
      prompt["464"].inputs.height = opts.height;
    }
  }

  for (const node of Object.values(prompt)) {
    if (node.class_type === "PrimitiveStringMultiline" && node.inputs.text != null) {
      if (node.inputs.value == null) node.inputs.value = node.inputs.text;
      delete node.inputs.text;
    }
    if (node.class_type === "StringConcatenate") {
      if (node.inputs.string_a == null && node.inputs.prefix != null) {
        node.inputs.string_a = node.inputs.prefix;
      }
      if (node.inputs.string_b == null && node.inputs.suffix != null) {
        node.inputs.string_b = node.inputs.suffix;
      }
      if (node.inputs.string_a == null) node.inputs.string_a = "";
      if (node.inputs.string_b == null) node.inputs.string_b = "";
      if (node.inputs.delimiter == null) node.inputs.delimiter = "";
      delete node.inputs.prefix;
      delete node.inputs.suffix;
    }
  }

  return { prompt, definitions: base.definitions };
}
