/**
 * Convert ComfyUI canvas workflow JSON → API prompt (+ definitions for subgraphs).
 * Usage: node scripts/convert-comfy-workflow.mjs [in.json] [out.json]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const SKIP_TYPES = new Set([
  "MarkdownNote",
  "Note",
  "PreviewImage",
  "PreviewAny",
  "MaskToImage",
]);

function linkMap(links) {
  const m = new Map();
  for (const row of links || []) {
    const [id, from, fromSlot, to, toSlot] = row;
    m.set(id, { from, fromSlot, to, toSlot });
  }
  return m;
}

function applyNamedWidgets(node, inputs) {
  const named = node.widgets_values_named;
  if (!named || typeof named !== "object") return;
  for (const [k, v] of Object.entries(named)) {
    inputs[k] = v;
  }
}

function applyWidgets(node, inputs) {
  const w = node.widgets_values;
  if (!Array.isArray(w) || !w.length) return;

  const t = node.type;
  if (t === "PrimitiveStringMultiline") {
    if (inputs.value == null) inputs.value = w[0];
    delete inputs.text;
    return;
  }
  if (t === "CLIPTextEncode") {
    if (inputs.text == null) inputs.text = w[0];
    return;
  }
  if (t === "LoadImage") {
    inputs.image = w[0];
    return;
  }
  if (t === "LoadVideo") {
    inputs.file = w[0];
    if (w[1] != null) inputs.format = w[1];
    return;
  }
  if (t === "SaveVideo") {
    inputs.filename_prefix = w[0];
    if (w[1] != null) inputs.format = w[1];
    if (w[2] != null) inputs.codec = w[2];
    return;
  }
  if (t === "RandomNoise") {
    inputs.noise_seed = w[0];
    if (w[1] != null) inputs.control = w[1];
    return;
  }
  if (t === "UNETLoader") {
    inputs.unet_name = w[0];
    if (w[1] != null) inputs.weight_dtype = w[1];
    return;
  }
  if (t === "CLIPLoader") {
    inputs.clip_name = w[0];
    if (w[1] != null) inputs.type = w[1];
    if (w[2] != null) inputs.device = w[2];
    return;
  }
  if (t === "VAELoader") {
    inputs.vae_name = w[0];
    return;
  }
  if (t === "LoraLoaderModelOnly") {
    inputs.lora_name = w[0];
    inputs.strength_model = w[1] ?? 1;
    return;
  }
  if (t === "KSamplerSelect") {
    inputs.sampler_name = w[0];
    return;
  }
  if (t === "BasicScheduler") {
    inputs.scheduler = w[0];
    inputs.steps = w[1];
    inputs.denoise = w[2];
    return;
  }
  if (t === "ImageScale") {
    inputs.upscale_method = w[0];
    inputs.width = w[1];
    inputs.height = w[2];
    inputs.crop = w[3];
    return;
  }
  if (t === "ImageScaleToTotalPixels") {
    inputs.upscale_method = w[0];
    inputs.megapixels = w[1];
    inputs.resolution_steps = w[2] ?? 1;
    return;
  }
  if (t === "ImageCompositeMasked") {
    inputs.x = w[0];
    inputs.y = w[1];
    inputs.resize_source = w[2];
    return;
  }
  if (t === "PrimitiveFloat") {
    inputs.value = w[0];
    return;
  }
  if (t === "ComfyMathExpression") {
    if (inputs.expression == null) inputs.expression = w[0];
    return;
  }
  if (t === "Video Slice") {
    if (inputs.start_time == null && w[0] != null) inputs.start_time = w[0];
    if (inputs.strict_duration == null && w[2] != null) {
      inputs.strict_duration = w[2];
    }
    delete inputs.end_time;
    delete inputs.max_frames;
    return;
  }
  if (t === "CreateVideo") {
    inputs.fps = w[0];
    inputs.bit_depth = w[1];
    return;
  }
  if (t === "StringConcatenate") {
    const parts = [w[0] ?? "", w[1] ?? "", w[2] ?? ""];
    if (inputs.string_a == null) inputs.string_a = parts[0];
    if (inputs.string_b == null) inputs.string_b = parts[1];
    if (inputs.delimiter == null) inputs.delimiter = parts[2];
    delete inputs.prefix;
    delete inputs.suffix;
    return;
  }
  if (t === "MiniMaxH3ReferenceToVideo") {
    if (inputs.prompt == null && w[0] != null) inputs.prompt = w[0];
    // Do not overwrite width/height/length when they are linked (e.g. GetImageSize)
    if (inputs.width == null && w[1] != null) inputs.width = w[1];
    if (inputs.height == null && w[2] != null) inputs.height = w[2];
    if (inputs.length == null && w[3] != null) inputs.length = w[3];
    if (inputs.ref_image_size == null && w[4] != null) {
      inputs.ref_image_size = w[4];
    }
    return;
  }
  if (t === "MiniMaxH3ScheduledSolAttentionPatch") {
    return;
  }
  if (t === "MiniMaxH3FusedModulation") {
    if (inputs.enabled == null) inputs.enabled = w[0];
    return;
  }
  if (t === "MiniMaxH3ChunkFeedForward") {
    return;
  }
  if (t === "SAM3_Detect") {
    if (inputs.threshold == null && w[0] != null) inputs.threshold = w[0];
    if (inputs.refine_iterations == null && w[1] != null) {
      inputs.refine_iterations = w[1];
    }
    if (inputs.individual_masks == null && w[2] != null) {
      inputs.individual_masks = w[2];
    }
    return;
  }
  if (t === "CheckpointLoaderSimple") {
    if (inputs.ckpt_name == null) inputs.ckpt_name = w[0];
    return;
  }

  // Subgraph SAM3 wrapper (UUID type) — widgets: text, threshold, ...
  if (/^[0-9a-f-]{36}$/i.test(t) && w.length >= 4) {
    inputs.text = w[0];
    inputs.threshold = w[1];
    inputs.refine_iterations = w[2];
    inputs.individual_masks = w[3];
    if (w[4] != null) inputs.ckpt_name = w[4];
  }
}

function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(s),
  );
}

function subgraphLinksById(links) {
  const m = new Map();
  for (const lk of links || []) m.set(lk.id, lk);
  return m;
}

function nodeToApiSubgraph(node, sgLinks, prefix, wrapperInputs, sgInputs) {
  if (node.mode === 4) return null;
  if (SKIP_TYPES.has(node.type) || node.type === "Note") return null;
  if (node.id === -10 || node.id === -20) return null;

  const inputs = {};
  let widgetIdx = 0;
  const w = node.widgets_values || [];

  for (const inp of node.inputs || []) {
    if (inp.link != null) {
      const lk = sgLinks.get(inp.link);
      if (!lk) continue;
      if (lk.origin_id === -10) {
        const sgIn = sgInputs[lk.origin_slot];
        if (sgIn && wrapperInputs[sgIn.name] !== undefined) {
          inputs[inp.name] = wrapperInputs[sgIn.name];
        }
      } else {
        inputs[inp.name] = [`${prefix}${lk.origin_id}`, lk.origin_slot];
      }
    } else if (inp.widget && widgetIdx < w.length) {
      inputs[inp.name] = w[widgetIdx++];
    }
  }

  applyWidgets(node, inputs);
  applyNamedWidgets(node, inputs);

  return {
    class_type: node.type,
    inputs,
  };
}

/** Expand Comfy subgraph wrappers (UUID class_type) into real nodes for /prompt API. */
function flattenSubgraphs(workflow, prompt) {
  const subgraphs = workflow.definitions?.subgraphs || [];
  const sgById = new Map(subgraphs.map((sg) => [sg.id, sg]));

  let changed = true;
  while (changed) {
    changed = false;
    for (const [wrapperId, wrapperNode] of Object.entries({ ...prompt })) {
      if (!isUuid(wrapperNode.class_type)) continue;
      const sg = sgById.get(wrapperNode.class_type);
      if (!sg) continue;

      changed = true;
      const prefix = `${wrapperId}_`;
      const sgLinks = subgraphLinksById(sg.links);
      const sgInputs = sg.inputs || [];

      for (const node of sg.nodes || []) {
        const api = nodeToApiSubgraph(
          node,
          sgLinks,
          prefix,
          wrapperNode.inputs,
          sgInputs,
        );
        if (api) prompt[`${prefix}${node.id}`] = api;
      }

      const outputMap = new Map();
      for (const lk of sg.links || []) {
        if (lk.target_id !== -20) continue;
        outputMap.set(lk.target_slot, [
          `${prefix}${lk.origin_id}`,
          lk.origin_slot,
        ]);
      }

      delete prompt[wrapperId];

      for (const node of Object.values(prompt)) {
        for (const [k, v] of Object.entries(node.inputs)) {
          if (Array.isArray(v) && String(v[0]) === wrapperId) {
            const mapped = outputMap.get(v[1]);
            if (mapped) node.inputs[k] = mapped;
          }
        }
      }
    }
  }

  return { prompt, definitions: undefined };
}

function buildSkipRedirects(workflow) {
  const links = linkMap(workflow.links);
  const redirects = new Map();

  for (const node of workflow.nodes || []) {
    if (!SKIP_TYPES.has(node.type)) continue;
    for (const inp of node.inputs || []) {
      if (inp.link == null) continue;
      const lk = links.get(inp.link);
      if (lk) {
        redirects.set(String(node.id), [String(lk.from), lk.fromSlot]);
        break;
      }
    }
  }

  return redirects;
}

function resolveNodeRef(nodeId, slot, redirects) {
  let cur = String(nodeId);
  let curSlot = slot;
  const seen = new Set();
  while (redirects.has(cur)) {
    if (seen.has(cur)) break;
    seen.add(cur);
    [cur, curSlot] = redirects.get(cur);
  }
  return [cur, curSlot];
}

function rewireSkippedReferences(prompt, redirects) {
  if (!redirects.size) return prompt;
  for (const node of Object.values(prompt)) {
    for (const [k, v] of Object.entries(node.inputs)) {
      if (
        Array.isArray(v) &&
        v.length === 2 &&
        typeof v[0] === "string" &&
        redirects.has(v[0])
      ) {
        node.inputs[k] = resolveNodeRef(v[0], v[1], redirects);
      }
    }
  }
  return prompt;
}

function nodeToApi(node, links) {
  if (node.mode === 4) return null;
  if (SKIP_TYPES.has(node.type)) return null;

  const inputs = {};
  let widgetIdx = 0;
  const w = node.widgets_values || [];

  for (const inp of node.inputs || []) {
    if (inp.link != null) {
      const lk = links.get(inp.link);
      if (lk) inputs[inp.name] = [String(lk.from), lk.fromSlot];
    } else if (inp.widget && widgetIdx < w.length) {
      inputs[inp.name] = w[widgetIdx++];
    }
  }

  applyWidgets(node, inputs);
  applyNamedWidgets(node, inputs);

  return {
    class_type: node.type,
    inputs,
  };
}

function normalizeApiPrompt(prompt) {
  for (const node of Object.values(prompt)) {
    if (node.class_type === "PrimitiveStringMultiline") {
      if (node.inputs.text != null && node.inputs.value == null) {
        node.inputs.value = node.inputs.text;
      }
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
  return prompt;
}

export function workflowToApiPrompt(workflow) {
  const links = linkMap(workflow.links);
  const skipRedirects = buildSkipRedirects(workflow);
  const prompt = {};

  for (const node of workflow.nodes || []) {
    const api = nodeToApi(node, links);
    if (api) prompt[String(node.id)] = api;
  }

  rewireSkippedReferences(prompt, skipRedirects);
  normalizeApiPrompt(prompt);
  return flattenSubgraphs(workflow, prompt);
}

function main() {
  const inPath =
    process.argv[2] ||
    path.join(ROOT, "workflows", "MiniMax_H3_Character_Ref2VA_READY.json");
  const outPath =
    process.argv[3] ||
    path.join(ROOT, "workflows", "MiniMax_H3_Character_Ref2VA_READY.api.json");

  const wf = JSON.parse(fs.readFileSync(inPath, "utf8"));
  const out = workflowToApiPrompt(wf);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  console.log("Wrote", outPath, "nodes:", Object.keys(out.prompt).length);
}

if (process.argv[1]?.includes("convert-comfy-workflow")) {
  main();
}
