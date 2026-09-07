#!/bin/bash
export PATH=/usr/bin:/bin
HF_IP=$(getent ahostsv4 huggingface.co | awk '{print $1; exit}')
echo HF_IP=$HF_IP
for url in \
  "https://huggingface.co/black-forest-labs/FLUX.2-klein-base-9B/resolve/main/flux-2-klein-base-9b.safetensors" \
  "https://huggingface.co/black-forest-labs/FLUX.2-klein-base-4B/resolve/main/flux-2-klein-base-4b.safetensors" \
  "https://huggingface.co/black-forest-labs/FLUX.2-klein-9B/resolve/main/flux-2-klein-9b.safetensors"
do
  code=$(curl -4 -sI -o /dev/null -w "%{http_code}" --resolve "huggingface.co:443:${HF_IP}" --max-redirs 0 "$url" || true)
  echo "$code $url"
done
