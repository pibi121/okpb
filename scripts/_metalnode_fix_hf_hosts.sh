#!/bin/bash
export PATH=/usr/bin:/bin
HF=$(getent ahostsv4 huggingface.co | awk '{print $1; exit}')
CDN=$(getent ahostsv4 us.aws.cdn.hf.co | awk '{print $1; exit}')
echo "HF=$HF CDN=$CDN"
grep -q 'huggingface.co' /etc/hosts || echo "$HF huggingface.co" >> /etc/hosts
grep -q 'us.aws.cdn.hf.co' /etc/hosts || echo "$CDN us.aws.cdn.hf.co" >> /etc/hosts
grep -q 'cas-bridge.xethub.hf.co' /etc/hosts || echo "$CDN cas-bridge.xethub.hf.co" >> /etc/hosts
# also cdn-lfs variants
for h in cdn-lfs.huggingface.co cdn-lfs-us-1.huggingface.co; do
  IP=$(getent ahostsv4 "$h" | awk '{print $1; exit}')
  if [ -n "$IP" ]; then
    grep -q "$h" /etc/hosts || echo "$IP $h" >> /etc/hosts
    echo "added $h -> $IP"
  fi
done
tail -10 /etc/hosts
ls -lh /work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors.part
pgrep -a curl | head -3
tail -3 /work/REDOWNLOAD_KLEIN_CURL.log
