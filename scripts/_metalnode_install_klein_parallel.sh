#!/bin/bash
export PATH=/usr/bin:/bin:/usr/local/bin
mkdir -p /work/ComfyUI/models/loras /work/ComfyUI/models/vae /work/ComfyUI/models/text_encoders

start_dl() {
  name="$1"
  url="$2"
  dest="$3"
  min="$4"
  if [ -f "$dest" ]; then
    sz=$(stat -c%s "$dest" 2>/dev/null)
    if [ -n "$sz" ] && [ "$sz" -ge "$min" ]; then
      echo "SKIP_${name}"
      return
    fi
  fi
  if pgrep -f "${dest}.part" >/dev/null 2>&1; then
    echo "ALREADY_${name}"
    return
  fi
  nohup wget -4 -c --timeout=60 --tries=0 -O "${dest}.part" "$url" > "/work/dl_${name}.log" 2>&1 &
  echo "STARTED_${name}:$!"
}

start_dl vae "https://huggingface.co/Comfy-Org/flux2-klein-9B/resolve/main/split_files/vae/flux2-vae.safetensors" \
  "/work/ComfyUI/models/vae/flux2-vae.safetensors" 300000000

start_dl lenovo "https://huggingface.co/lucymakeit/lenovo-ultrareal-flux-klein/resolve/main/lenovo_flux_klein9b.safetensors" \
  "/work/ComfyUI/models/loras/lenovo_flux_klein9b.safetensors" 100000000

start_dl snofs "https://huggingface.co/Ashen3/SNOFS/resolve/main/klein_snofs_v1_4.safetensors" \
  "/work/ComfyUI/models/loras/klein_snofs_v1_4.safetensors" 900000000

start_dl te8 "https://huggingface.co/Comfy-Org/flux2-klein-9B/resolve/main/split_files/text_encoders/qwen_3_8b_fp8mixed.safetensors" \
  "/work/ComfyUI/models/text_encoders/qwen_3_8b_fp8mixed.safetensors" 7000000000

start_dl te4 "https://huggingface.co/Comfy-Org/flux2-klein-9B/resolve/main/split_files/text_encoders/qwen_3_8b_fp4mixed.safetensors" \
  "/work/ComfyUI/models/text_encoders/qwen_3_8b_fp4mixed.safetensors" 5000000000

sleep 2
pgrep -a wget | head -20
ls -lh /work/ComfyUI/models/diffusion_models/*.part /work/ComfyUI/models/loras/*.part /work/ComfyUI/models/vae/*.part /work/ComfyUI/models/text_encoders/*.part 2>/dev/null
