#!/bin/bash
# Resume DiT download with guaranteed non-empty resolve IPs
export PATH=/usr/bin:/bin:/usr/local/bin
set -uo pipefail
DIT=/work/train/models/flux-2-klein-base-9b-fp8.safetensors
PART=${DIT}.part
LOG=/work/KLEIN_TRAIN_SETUP.log
mkdir -p /work/train/models

# Do not kill if another good curl already progressing fast - caller decides
# Clean poisoned hosts
grep -vE 'huggingface|hf\.co|xethub' /etc/hosts > /tmp/hosts.clean || true
cp /tmp/hosts.clean /etc/hosts

HF_IP=$(getent ahostsv4 huggingface.co | awk '{print $1; exit}')
CDN_IP=$(getent ahostsv4 us.aws.cdn.hf.co | awk '{print $1; exit}')
CAS_IP=$(getent ahostsv4 cas-bridge.xethub.hf.co | awk '{print $1; exit}')
[ -z "${HF_IP:-}" ] && HF_IP=143.204.238.49
[ -z "${CDN_IP:-}" ] && CDN_IP=15.237.164.118
[ -z "${CAS_IP:-}" ] && CAS_IP=143.204.238.128

# Guard against empty resolve (would break SSL)
if [ -z "$HF_IP" ] || [ -z "$CDN_IP" ]; then
  echo "[$(date +%H:%M:%S)] BAD_DNS HF='$HF_IP' CDN='$CDN_IP'" | tee -a "$LOG"
  exit 9
fi

echo "[$(date +%H:%M:%S)] DIT_RESUME HF=$HF_IP CDN=$CDN_IP CAS=$CAS_IP part=$(stat -c%s "$PART" 2>/dev/null || echo 0)" | tee -a "$LOG"
URL="https://huggingface.co/smegmarip/ComfyUI/resolve/main/diffusion_models/flux-2-klein-base-9b-fp8.safetensors"

# Probe first
curl -4 -sI -L --max-redirs 5 \
  --resolve "huggingface.co:443:${HF_IP}" \
  --resolve "us.aws.cdn.hf.co:443:${CDN_IP}" \
  --resolve "cas-bridge.xethub.hf.co:443:${CAS_IP}" \
  "$URL" 2>&1 | tr -d '\r' | grep -iE '^(HTTP/|location:|content-length:)' | tee -a "$LOG" | tail -15

curl -4 -L --retry 120 --retry-all-errors --retry-delay 3 -C - \
  --resolve "huggingface.co:443:${HF_IP}" \
  --resolve "us.aws.cdn.hf.co:443:${CDN_IP}" \
  --resolve "cas-bridge.xethub.hf.co:443:${CAS_IP}" \
  --connect-timeout 30 \
  -o "$PART" "$URL" >> "$LOG" 2>&1
rc=$?
sz=$(stat -c%s "$PART" 2>/dev/null || echo 0)
echo "[$(date +%H:%M:%S)] curl_dit_exit=$rc size=$sz" | tee -a "$LOG"

if [ "$rc" -eq 0 ] && [ "$sz" -ge 9000000000 ]; then
  mv -f "$PART" "$DIT"
  ln -sfn /work/ComfyUI/models/vae/ae.safetensors /work/train/models/ae.safetensors
  ln -sfn /work/ComfyUI/models/text_encoders/qwen_3_8b_fp8mixed.safetensors /work/train/models/qwen_3_8b_fp8mixed.safetensors
  echo "[$(date +%H:%M:%S)] DIT_READY $(ls -lh "$DIT")" | tee -a "$LOG"
  exit 0
fi
echo "[$(date +%H:%M:%S)] DIT_FAIL rc=$rc size=$sz" | tee -a "$LOG"
exit 1
