#!/bin/bash
export PATH=/usr/bin:/bin:/usr/local/bin
set -uo pipefail
LOG=/work/KLEIN_TRAIN_SETUP.log
DIT=/work/train/models/flux-2-klein-base-9b-fp8.safetensors
mkdir -p /work/train/models
pkill -f 'flux-2-klein-base-9b-fp8' || true
sleep 1
# clean poisoned hosts
grep -vE 'huggingface|hf\.co|xethub' /etc/hosts > /tmp/hosts.clean || true
cp /tmp/hosts.clean /etc/hosts

HF_IP=$(getent ahostsv4 huggingface.co | awk '{print $1; exit}')
CDN_IP=$(getent ahostsv4 us.aws.cdn.hf.co | awk '{print $1; exit}')
CAS_IP=$(getent ahostsv4 cas-bridge.xethub.hf.co | awk '{print $1; exit}')
echo "[$(date +%H:%M:%S)] DIT2 HF=$HF_IP CDN=$CDN_IP CAS=$CAS_IP" | tee -a "$LOG"

RESOLVE=(--resolve "huggingface.co:443:${HF_IP}")
[ -n "${CDN_IP:-}" ] && RESOLVE+=(--resolve "us.aws.cdn.hf.co:443:${CDN_IP}")
[ -n "${CAS_IP:-}" ] && RESOLVE+=(--resolve "cas-bridge.xethub.hf.co:443:${CAS_IP}")

URL="https://huggingface.co/smegmarip/ComfyUI/resolve/main/diffusion_models/flux-2-klein-base-9b-fp8.safetensors"
# probe
curl -4 -sI -L --max-redirs 5 "${RESOLVE[@]}" "$URL" 2>&1 | tr -d '\r' | grep -iE '^(HTTP/|location:|content-length:)' | tee -a "$LOG" | tail -20

echo "[$(date +%H:%M:%S)] CURL_DIT_START" | tee -a "$LOG"
curl -4 -L --retry 50 --retry-all-errors --retry-delay 3 -C - \
  "${RESOLVE[@]}" --connect-timeout 30 \
  -o "${DIT}.part" "$URL" >> "$LOG" 2>&1
rc=$?
echo "[$(date +%H:%M:%S)] curl_dit_exit=$rc size=$(stat -c%s "${DIT}.part" 2>/dev/null || echo 0)" | tee -a "$LOG"
if [ "$rc" -eq 0 ] && [ -f "${DIT}.part" ]; then
  mv -f "${DIT}.part" "$DIT"
  ln -sfn /work/ComfyUI/models/vae/ae.safetensors /work/train/models/ae.safetensors
  ln -sfn /work/ComfyUI/models/text_encoders/qwen_3_8b_fp8mixed.safetensors /work/train/models/qwen_3_8b_fp8mixed.safetensors
  echo "[$(date +%H:%M:%S)] DIT_READY $(ls -lh "$DIT")" | tee -a "$LOG"
fi
