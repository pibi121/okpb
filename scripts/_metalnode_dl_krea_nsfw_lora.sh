#!/bin/bash
set -euo pipefail
OUT=/work/ComfyUI/models/loras/krea2
LOG=/work/logs/krea_nsfw_lora.log
mkdir -p "$OUT"
exec > >(tee -a "$LOG") 2>&1

# stop bloated full-repo download if still running
pkill -f 'hf download Sentinel7/krea2 --local-dir' 2>/dev/null || true

source /work/ai/venv/bin/activate
export HF_XET_HIGH_PERFORMANCE=1

echo "[$(date -Is)] START KNPV4.1_pre from HF"
hf download diobrando0/krea2_loras_public KNPV4.1_pre.safetensors --local-dir /tmp/knp_dl
mv -f /tmp/knp_dl/KNPV4.1_pre.safetensors "$OUT/KNPV4.1_pre.safetensors"
# alias name expected by workflow
cp -f "$OUT/KNPV4.1_pre.safetensors" "$OUT/KNP_v4.3_EXP.safetensors" 2>/dev/null || ln -sf KNPV4.1_pre.safetensors "$OUT/KNP_v4.3_EXP.safetensors"
ls -lh "$OUT/KNPV4.1_pre.safetensors"

# try filterbypass from Sentinel if present path known; otherwise skip
echo "[$(date -Is)] trying filterbypass"
hf download Sentinel7/krea2 2728234/3067151/krea2filterbypass3.safetensors --local-dir /tmp/bypass_dl 2>/dev/null \
  && mv -f /tmp/bypass_dl/2728234/3067151/krea2filterbypass3.safetensors "$OUT/" \
  || echo "filterbypass not on this mirror, will smoke without it"

ls -lh "$OUT"
echo ALL_DONE
