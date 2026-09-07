#!/bin/bash
set -euo pipefail
grep -vE 'huggingface|hf\.co|xethub' /etc/hosts > /tmp/hosts.clean || true
HF=$(getent ahostsv4 huggingface.co | awk '{print $1; exit}')
CDN=$(getent ahostsv4 us.aws.cdn.hf.co | awk '{print $1; exit}')
CAS=$(getent ahostsv4 cas-bridge.xethub.hf.co | awk '{print $1; exit}')
echo "HF=$HF CDN=$CDN CAS=$CAS"
[ -n "$HF" ] && echo "$HF huggingface.co" >> /tmp/hosts.clean
[ -n "$CDN" ] && echo "$CDN us.aws.cdn.hf.co" >> /tmp/hosts.clean
[ -n "$CAS" ] && echo "$CAS cas-bridge.xethub.hf.co" >> /tmp/hosts.clean
cp /tmp/hosts.clean /etc/hosts
echo "=== hosts ==="
grep -E 'huggingface|hf\.co|xethub' /etc/hosts || true
echo "=== curl ==="
ps aux | grep '[c]url.*klein' || echo none
echo "=== part ==="
ls -lh /work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors* 2>/dev/null || true
