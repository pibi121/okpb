#!/bin/bash
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
LOG=/work/INSTALL_KLEIN.log
STATUS=/work/INSTALL_KLEIN_STATUS.txt
echo RUNNING > "$STATUS"
: > "$LOG"

log(){ echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

filesize(){
  stat -c%s "$1" 2>/dev/null
  if [ $? -ne 0 ]; then echo 0; fi
}

dl(){
  url="$1"
  dest="$2"
  min="$3"
  mkdir -p "$(dirname "$dest")"
  if [ -f "$dest" ]; then
    sz=$(filesize "$dest")
    if [ "$sz" -ge "$min" ]; then
      log "SKIP $dest ($sz)"
      return 0
    fi
  fi
  part="${dest}.part"
  rm -f "$part"
  log "WGET $url -> $dest"
  i=1
  while [ $i -le 5 ]; do
    if wget -4 -c --timeout=60 --tries=3 -O "$part" "$url"; then
      sz=$(filesize "$part")
      if [ "$sz" -ge "$min" ]; then
        mv -f "$part" "$dest"
        log "OK $dest ($sz)"
        return 0
      fi
      log "TOO_SMALL try$i $sz"
    else
      log "WGET_FAIL try$i"
    fi
    i=$((i+1))
    sleep 3
  done
  log "FAIL $dest"
  return 1
}

log START
ok=1

dl "https://huggingface.co/titomatus0203/flux-2-klein-9b-fp8/resolve/main/flux-2-klein-9b-fp8.safetensors" \
  /work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors 8000000000
if [ $? -ne 0 ]; then
  dl "https://huggingface.co/rkppvc/flux-2-klein-9b.safetensors/resolve/main/flux-2-klein-9b.safetensors" \
    /work/ComfyUI/models/diffusion_models/flux-2-klein-9b.safetensors 15000000000
  if [ $? -ne 0 ]; then ok=0; fi
fi

dl "https://huggingface.co/Comfy-Org/flux2-klein-9B/resolve/main/split_files/text_encoders/qwen_3_8b_fp8mixed.safetensors" \
  /work/ComfyUI/models/text_encoders/qwen_3_8b_fp8mixed.safetensors 7000000000
if [ $? -ne 0 ]; then ok=0; fi

dl "https://huggingface.co/Comfy-Org/flux2-klein-9B/resolve/main/split_files/text_encoders/qwen_3_8b_fp4mixed.safetensors" \
  /work/ComfyUI/models/text_encoders/qwen_3_8b_fp4mixed.safetensors 5000000000
if [ $? -ne 0 ]; then ok=0; fi

dl "https://huggingface.co/Comfy-Org/flux2-klein-9B/resolve/main/split_files/vae/flux2-vae.safetensors" \
  /work/ComfyUI/models/vae/flux2-vae.safetensors 300000000
if [ $? -ne 0 ]; then ok=0; fi

dl "https://huggingface.co/Ashen3/SNOFS/resolve/main/klein_snofs_v1_4.safetensors" \
  /work/ComfyUI/models/loras/klein_snofs_v1_4.safetensors 900000000
if [ $? -ne 0 ]; then ok=0; fi

dl "https://huggingface.co/lucymakeit/lenovo-ultrareal-flux-klein/resolve/main/lenovo_flux_klein9b.safetensors" \
  /work/ComfyUI/models/loras/lenovo_flux_klein9b.safetensors 100000000
if [ $? -ne 0 ]; then ok=0; fi

cd /work/ComfyUI/models/diffusion_models
if [ -f flux-2-klein-9b-fp8.safetensors ]; then
  if [ ! -e flux-2-klein-9b.safetensors ]; then
    ln -s flux-2-klein-9b-fp8.safetensors flux-2-klein-9b.safetensors
    log "SYMLINK flux-2-klein-9b.safetensors"
  fi
fi

if [ "$ok" = 1 ]; then
  echo READY > "$STATUS"
else
  echo PARTIAL > "$STATUS"
fi

{
  cat "$STATUS"
  ls -lh /work/ComfyUI/models/diffusion_models/*klein* 2>/dev/null
  ls -lh /work/ComfyUI/models/text_encoders/qwen_3_8b* 2>/dev/null
  ls -lh /work/ComfyUI/models/vae/flux2-vae* 2>/dev/null
  ls -lh /work/ComfyUI/models/loras/klein_snofs* /work/ComfyUI/models/loras/lenovo_flux* 2>/dev/null
} | tee -a "$STATUS"

log DONE
