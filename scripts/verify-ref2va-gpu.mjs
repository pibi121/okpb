#!/usr/bin/env node
/** Verify Ref2VA workflow deps on Metalnode Comfy GPU. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const cfg = JSON.parse(
  fs.readFileSync(path.join(ROOT, "infra", "metalnode.local.json"), "utf8"),
);

const REMOTE = `set -euo pipefail
V=/work/ai/venv/bin
C=/work/ComfyUI
echo "=== Comfy process ==="
ps aux | grep 'main.py' | grep -v grep || true
echo "=== Models ==="
for f in \\
  "$C/models/diffusion_models/minimax_h3_ref2va_pruned_fp8_scaled.safetensors" \\
  "$C/models/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors" \\
  "$C/models/vae/minimax_h3_video_vae_fp16.safetensors" \\
  "$C/models/vae/minimax_h3_audio_vae_fp32.safetensors" \\
  "$C/models/checkpoints/sam3.1_multiplex_fp16.safetensors" \\
  "$C/models/loras/minimax_h3_turbo_v4_step600_ema_pruned_comfyui.safetensors"; do
  test -f "$f" && echo OK "$f" || echo MISSING "$f"
done
echo "=== Custom nodes ==="
for d in ComfyUI-sol-attn ComfyUI-KJNodes ComfyUI-MiniMaxH3-Contex-Loop; do
  test -d "$C/custom_nodes/$d" && echo OK "$d" || echo MISSING "$d"
done
echo "=== Comfy nodes ==="
curl -sf http://127.0.0.1:8188/object_info/SAM3_Detect >/dev/null && echo OK SAM3_Detect
curl -sf http://127.0.0.1:8188/object_info/MiniMaxH3ScheduledSolAttentionPatch >/dev/null && echo OK SolPatch
curl -sf http://127.0.0.1:8188/object_info/MiniMaxH3FusedModulation >/dev/null && echo OK FusedMod
curl -sf http://127.0.0.1:8188/object_info/MiniMaxH3ChunkFeedForward >/dev/null && echo OK ChunkFF
curl -sf http://127.0.0.1:8188/object_info/MiniMaxH3ReferenceToVideo >/dev/null && echo OK Ref2V
echo "=== sageattention (optional) ==="
$V/python -c "import sageattention; print('installed', sageattention.__file__)" 2>/dev/null || echo "not installed (workflow bypasses Sage nodes)"
`;

const r = spawnSync(
  "ssh.exe",
  [
    "-i",
    cfg.sshKeyPath,
    "-p",
    String(cfg.sshPort),
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    `${cfg.sshUser}@${cfg.host}`,
    "bash -s",
  ],
  { input: REMOTE, encoding: "utf8", timeout: 120_000, windowsHide: true },
);
process.stdout.write(r.stdout || "");
process.stderr.write(r.stderr || "");
process.exit(r.status ?? 1);
