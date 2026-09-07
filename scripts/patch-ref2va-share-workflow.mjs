/**
 * Patch MiniMax_H3_Character_Ref2VA_SHARE.json for our Metalnode stack:
 * - fp8 ref2va + nvfp4 clip (already on GPU)
 * - bypass RTX upscaler (optional node, needs local RTX VFX SDK)
 * - keep SAM3 + turbo LoRA filenames (download via setup script)
 *
 * Usage:
 *   node scripts/patch-ref2va-share-workflow.mjs [input.json] [output.json]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const INPUT =
  process.argv[2] ||
  path.join(
    process.env.USERPROFILE || "",
    "Downloads",
    "MiniMax_H3_Character_Ref2VA_SHARE.json",
  );
const OUTPUT =
  process.argv[3] ||
  path.join(ROOT, "workflows", "MiniMax_H3_Character_Ref2VA_READY.json");

const REPLACEMENTS = [
  [
    /minimax_h3_ref2va_pruned_int8_convrot\.safetensors/g,
    "minimax_h3_ref2va_pruned_fp8_scaled.safetensors",
  ],
  [
    /qwen3vl_32b_h3_ultra_uncensored_heretic_int8_convrot\.safetensors/g,
    "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
  ],
  [
    /sam3\.1_multiple_x_fp16\.safetensors/g,
    "sam3.1_multiplex_fp16.safetensors",
  ],
];

function patchWorkflow(raw) {
  let text = raw;
  for (const [re, rep] of REPLACEMENTS) text = text.replace(re, rep);

  const wf = JSON.parse(text);

  // Bypass RTXVideoSuperResolution (node 525): feed VAEDecode (472) -> CreateVideo (476)
  for (const link of wf.links) {
    if (link[0] === 777) {
      link[1] = 472;
      link[2] = 0;
    }
  }
  // Remove RTXVideoSuperResolution node (needs local RTX VFX SDK; not on Metalnode path)
  wf.nodes = wf.nodes.filter(
    (n) => !(n.id === 525 && n.type === "RTXVideoSuperResolution"),
  );
  wf.links = wf.links.filter((l) => l[1] !== 525 && l[2] !== 525);
  for (const node of wf.nodes) {
    if (node.id === 472 && node.type === "VAEDecode") {
      const out = node.outputs?.find((o) => o.name === "IMAGE");
      if (out && !out.links.includes(777)) out.links.push(777);
    }
  }

  // Bypass KJ Sage nodes (503, 519): sageattention is not available on RTX 5090 stack.
  // Turbo LoRA (502) -> Sol scheduled patch (520) -> fused mod (521) -> chunk FF (522).
  for (const link of wf.links) {
    if (link[0] === 732) link[3] = 520;
  }
  wf.links = wf.links.filter((l) => l[0] !== 769 && l[0] !== 770);
  for (const node of wf.nodes) {
    if (node.id === 503 || node.id === 519) {
      node.mode = 4;
      if (node.inputs?.[0]) node.inputs[0].link = null;
      const out = node.outputs?.[0];
      if (out) out.links = [];
    }
    if (node.id === 502) {
      const out = node.outputs?.find((o) => o.name === "MODEL");
      if (out) out.links = [732];
    }
    if (node.id === 520 && node.inputs?.[0]) node.inputs[0].link = 732;
  }

  // Patch nested SAM3 subgraph if present
  if (Array.isArray(wf.definitions?.subgraphs)) {
    for (const sg of wf.definitions.subgraphs) {
      if (!sg.nodes) continue;
      for (const node of sg.nodes) {
        if (node.widgets_values?.length) {
          node.widgets_values = node.widgets_values.map((v) =>
            typeof v === "string"
              ? REPLACEMENTS.reduce((s, [re, rep]) => s.replace(re, rep), v)
              : v,
          );
        }
      }
    }
  }

  wf.extra = wf.extra || {};
  wf.extra.peach_patched = {
    at: new Date().toISOString(),
    models: "fp8 ref2va + nvfp4 clip; download SAM3 + turbo LoRA on GPU",
    rtx_upscaler: "bypassed (muted node 525)",
    sage_attention: "bypassed nodes 503+519 (no sageattention on RTX5090; Sol-attn chain kept)",
    setup: "bash scripts/setup-ref2va-share-gpu.sh on Metalnode, then load this JSON",
  };

  return wf;
}

if (!fs.existsSync(INPUT)) {
  console.error("Input workflow not found:", INPUT);
  process.exit(1);
}

const out = patchWorkflow(fs.readFileSync(INPUT, "utf8"));
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(out, null, 2), "utf8");

const dest = path.join(
  process.env.USERPROFILE || "",
  "Downloads",
  "MiniMax_H3_Character_Ref2VA_READY.json",
);
try {
  fs.copyFileSync(OUTPUT, dest);
  console.log("Also copied to:", dest);
} catch {
  /* ignore */
}

console.log("Wrote:", OUTPUT);
