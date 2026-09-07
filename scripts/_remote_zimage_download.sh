#!/bin/bash
set -euo pipefail
mkdir -p /workspace/models/diffusion_models \
         /workspace/models/text_encoders \
         /workspace/models/vae \
         /workspace/logs

download() {
  local out="$1"
  local url="$2"
  local log="$3"
  echo "START $(date -Is) -> $out" | tee -a "$log"
  wget -c --progress=dot:giga -O "$out" "$url" >>"$log" 2>&1
  echo "DONE $(date -Is) $(ls -lh "$out")" | tee -a "$log"
}

download /workspace/models/diffusion_models/z_image_turbo_bf16.safetensors \
  "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors" \
  /workspace/logs/dl_turbo.log &

download /workspace/models/text_encoders/qwen_3_4b.safetensors \
  "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors" \
  /workspace/logs/dl_qwen.log &

download /workspace/models/vae/ae.safetensors \
  "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors" \
  /workspace/logs/dl_vae.log &

wait
echo "ALL_DOWNLOADS_DONE $(date -Is)"
ls -lh /workspace/models/diffusion_models/z_image_turbo_bf16.safetensors \
       /workspace/models/text_encoders/qwen_3_4b.safetensors \
       /workspace/models/vae/ae.safetensors
