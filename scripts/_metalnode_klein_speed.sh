#!/bin/bash
export PATH=/usr/bin:/bin:/usr/local/bin
PART=/work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors.part
DEST=/work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors
URL=https://huggingface.co/titomatus0203/flux-2-klein-9b-fp8/resolve/main/flux-2-klein-9b-fp8.safetensors

s1=0
if [ -f "$PART" ]; then s1=$(stat -c%s "$PART"); fi
sleep 8
s2=0
if [ -f "$PART" ]; then s2=$(stat -c%s "$PART"); fi
echo "size_now=$s2"
echo "delta8s=$((s2-s1))"
echo "rate_MBps=$(python3 -c "print(round(($s2-$s1)/8/1e6,3))")"
pgrep -a wget | head
pgrep -a curl | head
# if stalled (<1MB in 8s), restart with curl continue
if [ $((s2-s1)) -lt 1000000 ]; then
  echo STALLED_RESTART
  pkill -f flux-2-klein-9b-fp8.safetensors.part || true
  sleep 2
  nohup curl -4 -L --retry 99 --retry-all-errors --retry-delay 2 -C - \
    -o "$PART" "$URL" > /work/dl_klein_curl.log 2>&1 &
  echo CURL_PID:$!
fi
