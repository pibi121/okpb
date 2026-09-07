#!/bin/bash
set -euo pipefail
source /work/ai/venv/bin/activate
export HF_XET_HIGH_PERFORMANCE=1
LOG=/work/logs/krea2_dl.log
mkdir -p /work/ComfyUI/models/diffusion_models/krea2 /tmp/krea2_dl_fp8turbo

echo "[$(date -Is)] START turbo fp8" | tee -a "$LOG"
hf download Comfy-Org/Krea-2 diffusion_models/krea2_turbo_fp8_scaled.safetensors \
  --local-dir /tmp/krea2_dl_fp8turbo >>"$LOG" 2>&1
mv -f /tmp/krea2_dl_fp8turbo/diffusion_models/krea2_turbo_fp8_scaled.safetensors \
  /work/ComfyUI/models/diffusion_models/krea2/
ls -lh /work/ComfyUI/models/diffusion_models/krea2/krea2_turbo_fp8_scaled.safetensors | tee -a "$LOG"
echo "[$(date -Is)] DONE turbo fp8" | tee -a "$LOG"
