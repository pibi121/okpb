#!/bin/bash
export PATH=/usr/bin:/bin:/usr/local/bin

# Move completed parts if size OK and no wget -O targeting this part
move_if_done() {
  part="$1"
  dest="$2"
  min="$3"
  if [ ! -f "$part" ]; then
    return
  fi
  if [ -f "$dest" ]; then
    szd=$(stat -c%s "$dest")
    if [ "$szd" -ge "$min" ]; then
      rm -f "$part"
      echo "KEEP $dest"
      return
    fi
  fi
  sz=$(stat -c%s "$part")
  if [ "$sz" -lt "$min" ]; then
    echo "WAIT $part $sz/$min"
    return
  fi
  # kill any wget still holding this part (should be finished if size ok)
  pkill -f "wget .*${part}" 2>/dev/null
  sleep 1
  mv -f "$part" "$dest"
  echo "MOVED $dest $sz"
}

move_if_done /work/ComfyUI/models/vae/flux2-vae.safetensors.part \
  /work/ComfyUI/models/vae/flux2-vae.safetensors 300000000

move_if_done /work/ComfyUI/models/loras/lenovo_flux_klein9b.safetensors.part \
  /work/ComfyUI/models/loras/lenovo_flux_klein9b.safetensors 100000000

move_if_done /work/ComfyUI/models/loras/klein_snofs_v1_4.safetensors.part \
  /work/ComfyUI/models/loras/klein_snofs_v1_4.safetensors 900000000

move_if_done /work/ComfyUI/models/text_encoders/qwen_3_8b_fp4mixed.safetensors.part \
  /work/ComfyUI/models/text_encoders/qwen_3_8b_fp4mixed.safetensors 5000000000

move_if_done /work/ComfyUI/models/text_encoders/qwen_3_8b_fp8mixed.safetensors.part \
  /work/ComfyUI/models/text_encoders/qwen_3_8b_fp8mixed.safetensors 7000000000

move_if_done /work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors.part \
  /work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors 8000000000

# Stop the slow sequential installer; keep parallel wgets for unfinished big files
pkill -f '/tmp/install_klein.sh' 2>/dev/null

# If klein still incomplete, ensure a dedicated wget is running
if [ ! -f /work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors ]; then
  if ! pgrep -f 'flux-2-klein-9b-fp8.safetensors.part' >/dev/null 2>&1; then
    nohup wget -4 -c --timeout=60 --tries=0 \
      -O /work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors.part \
      "https://huggingface.co/titomatus0203/flux-2-klein-9b-fp8/resolve/main/flux-2-klein-9b-fp8.safetensors" \
      > /work/dl_klein.log 2>&1 &
    echo "RESTARTED_KLEIN:$!"
  else
    echo "KLEIN_DOWNLOADING"
  fi
fi

# If te8 incomplete, ensure wget
if [ ! -f /work/ComfyUI/models/text_encoders/qwen_3_8b_fp8mixed.safetensors ]; then
  if ! pgrep -f 'qwen_3_8b_fp8mixed.safetensors.part' >/dev/null 2>&1; then
    nohup wget -4 -c --timeout=60 --tries=0 \
      -O /work/ComfyUI/models/text_encoders/qwen_3_8b_fp8mixed.safetensors.part \
      "https://huggingface.co/Comfy-Org/flux2-klein-9B/resolve/main/split_files/text_encoders/qwen_3_8b_fp8mixed.safetensors" \
      > /work/dl_te8.log 2>&1 &
    echo "RESTARTED_TE8:$!"
  else
    echo "TE8_DOWNLOADING"
  fi
fi

# symlink alias when ready
cd /work/ComfyUI/models/diffusion_models
if [ -f flux-2-klein-9b-fp8.safetensors ]; then
  if [ ! -e flux-2-klein-9b.safetensors ]; then
    ln -s flux-2-klein-9b-fp8.safetensors flux-2-klein-9b.safetensors
    echo SYMLINK_OK
  fi
fi

echo ===STATUS===
ls -lh /work/ComfyUI/models/diffusion_models/*klein* 2>/dev/null
ls -lh /work/ComfyUI/models/text_encoders/qwen_3_8b* 2>/dev/null
ls -lh /work/ComfyUI/models/vae/flux2-vae* 2>/dev/null
ls -lh /work/ComfyUI/models/loras/klein_snofs* /work/ComfyUI/models/loras/lenovo_flux* 2>/dev/null
pgrep -a wget | head -10
