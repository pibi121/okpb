#!/bin/bash
export PATH=/usr/bin:/bin
# remove broken host lines (no IP)
sed -i '/^ us\.aws\.cdn\.hf\.co$/d' /etc/hosts
sed -i '/^ cas-bridge\.xethub\.hf\.co$/d' /etc/hosts
HF=$(getent ahostsv4 huggingface.co | awk '{print $1; exit}')
CDN=$(getent ahostsv4 us.aws.cdn.hf.co | awk '{print $1; exit}')
echo "HF=$HF CDN=$CDN"
if [ -n "$HF" ]; then
  grep -q 'huggingface.co' /etc/hosts || echo "$HF huggingface.co" >> /etc/hosts
fi
if [ -n "$CDN" ]; then
  grep -q 'us.aws.cdn.hf.co' /etc/hosts || echo "$CDN us.aws.cdn.hf.co" >> /etc/hosts
  grep -q 'cas-bridge.xethub.hf.co' /etc/hosts || echo "$CDN cas-bridge.xethub.hf.co" >> /etc/hosts
fi
grep -E 'huggingface|cdn.hf|xethub' /etc/hosts
ls -lh /work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors.part
