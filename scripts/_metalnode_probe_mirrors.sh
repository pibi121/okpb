#!/bin/bash
export PATH=/usr/bin:/bin
HF_IP=$(getent ahostsv4 huggingface.co | awk '{print $1; exit}')
for url in \
  "https://huggingface.co/smegmarip/ComfyUI/resolve/main/diffusion_models/flux-2-klein-base-9b-fp8.safetensors" \
  "https://huggingface.co/titomatus0203/flux-2-klein-9b-fp8/resolve/main/flux-2-klein-9b-fp8.safetensors"
do
  code=$(curl -4 -sI -L --max-redirs 5 -o /dev/null -w "%{http_code}" --resolve "huggingface.co:443:${HF_IP}" "$url" || true)
  echo "$code $url"
done
