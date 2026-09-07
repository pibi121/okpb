#!/bin/bash
# Download Klein base-9B FP8 + setup musubi-tuner for character LoRA
set -euo pipefail
export PATH=/usr/bin:/bin:/usr/local/bin
LOG=/work/KLEIN_TRAIN_SETUP.log
: > "$LOG"
log(){ echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

mkdir -p /work/train/models /work/loras_out /work/datasets /work/hf_cache
cd /work/train

# --- musubi-tuner ---
if [ ! -d musubi-tuner/.git ]; then
  log "CLONE_MUSUBI"
  rm -rf musubi-tuner
  GIT_TERMINAL_PROMPT=0 git -c credential.helper= clone --depth 1 https://github.com/kohya-ss/musubi-tuner.git musubi-tuner
fi
log "musubi=$(cd musubi-tuner && git rev-parse --short HEAD)"

# --- base DiT fp8 (ungated community) ---
DIT=/work/train/models/flux-2-klein-base-9b-fp8.safetensors
EXPECT_MIN=9000000000
if [ -f "$DIT" ] && [ "$(stat -c%s "$DIT")" -ge "$EXPECT_MIN" ]; then
  log "DIT_EXISTS $(stat -c%s "$DIT")"
else
  log "DIT_DOWNLOAD_START"
  HF_IP=$(getent ahostsv4 huggingface.co | awk '{print $1; exit}')
  CDN_IP=$(getent ahostsv4 us.aws.cdn.hf.co | awk '{print $1; exit}')
  CAS_IP=$(getent ahostsv4 cas-bridge.xethub.hf.co | awk '{print $1; exit}')
  RESOLVE=(--resolve "huggingface.co:443:${HF_IP}")
  [ -n "$CDN_IP" ] && RESOLVE+=(--resolve "us.aws.cdn.hf.co:443:${CDN_IP}")
  [ -n "$CAS_IP" ] && RESOLVE+=(--resolve "cas-bridge.xethub.hf.co:443:${CAS_IP}")
  URL="https://huggingface.co/smegmarip/ComfyUI/resolve/main/diffusion_models/flux-2-klein-base-9b-fp8.safetensors"
  curl -4 -L --retry 40 --retry-all-errors --retry-delay 3 -C - \
    "${RESOLVE[@]}" --connect-timeout 30 \
    -o "${DIT}.part" "$URL" >> "$LOG" 2>&1
  mv -f "${DIT}.part" "$DIT"
  log "DIT_DONE $(stat -c%s "$DIT")"
fi

# VAE symlink
mkdir -p /work/train/models
ln -sfn /work/ComfyUI/models/vae/ae.safetensors /work/train/models/ae.safetensors
ln -sfn /work/ComfyUI/models/vae/flux2-vae.safetensors /work/train/models/flux2-vae.safetensors
# TE - try comfy single file for now
ln -sfn /work/ComfyUI/models/text_encoders/qwen_3_8b_fp8mixed.safetensors /work/train/models/qwen_3_8b_fp8mixed.safetensors

log "FILES"
ls -lh /work/train/models/ | tee -a "$LOG"
log "SETUP_PARTIAL_OK"
