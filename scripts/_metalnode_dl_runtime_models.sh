#!/bin/bash
# Download the models peachbitch needs on a fresh Metalnode.
set -u
export HF_HUB_ENABLE_HF_TRANSFER=1
export HF_XET_HIGH_PERFORMANCE=1
LOG=/work/logs/peach_models.log
mkdir -p /work/logs \
  /work/ComfyUI/models/diffusion_models/krea2 \
  /work/ComfyUI/models/text_encoders \
  /work/ComfyUI/models/vae \
  /work/ComfyUI/models/loras/krea2
exec >>"$LOG" 2>&1
echo "===== MODELS $(date -Is) ====="

PY=/work/ai/venv/bin/python
PIP=/work/ai/venv/bin/pip
HF=/work/ai/venv/bin/hf
$PIP -q install -U huggingface_hub hf_transfer 2>/dev/null || $PIP install -U huggingface_hub hf_transfer

dl() {
  local repo="$1" rpath="$2" dest="$3" min="${4:-1000000}"
  if [ -f "$dest" ]; then
    local sz; sz=$(stat -c%s "$dest" 2>/dev/null || echo 0)
    if [ "$sz" -ge "$min" ]; then
      echo "HAVE $(basename "$dest") ${sz}"
      return 0
    fi
  fi
  echo "DL $repo $rpath -> $dest"
  local tmpdir; tmpdir=$(mktemp -d)
  if $HF download "$repo" "$rpath" --local-dir "$tmpdir"; then
    local found
    found=$(find "$tmpdir" -type f -name "$(basename "$rpath")" | head -1)
    if [ -n "$found" ]; then
      mv -f "$found" "$dest"
      echo "OK $(basename "$dest") $(stat -c%s "$dest")"
      rm -rf "$tmpdir"
      return 0
    fi
  fi
  echo "FAIL $repo $rpath"
  rm -rf "$tmpdir"
  return 1
}

# Photo (Krea) — first
dl Comfy-Org/Krea-2 diffusion_models/krea2_turbo_fp8_scaled.safetensors \
  /work/ComfyUI/models/diffusion_models/krea2/krea2_turbo_fp8_scaled.safetensors 1000000000
dl Comfy-Org/Wan_2.2_ComfyUI_Repackaged split_files/vae/wan_2.1_vae.safetensors \
  /work/ComfyUI/models/vae/wan_2.1_vae.safetensors 100000000
dl Comfy-Org/Qwen-Image_ComfyUI split_files/vae/qwen_image_vae.safetensors \
  /work/ComfyUI/models/vae/qwen_image_vae.safetensors 100000000
dl diobrando0/krea2_loras_public KNPV4.1_pre.safetensors \
  /work/ComfyUI/models/loras/krea2/KNPV4.1_pre.safetensors 10000000
dl conradlocke/krea2-identity-edit krea2_identity_edit_v1_2.safetensors \
  /work/ComfyUI/models/loras/krea2/krea2_identity_edit_v1_2.safetensors 100000000

# Official CLIP, then Huihui name (file or symlink) so graphs validate
dl Comfy-Org/Krea-2 text_encoders/qwen3vl_4b_fp8_scaled.safetensors \
  /work/ComfyUI/models/text_encoders/qwen3vl_4b_fp8_scaled.safetensors 100000000 || true
DEST=/work/ComfyUI/models/text_encoders/Huihui-Qwen3-VL-4B-Instruct-abliterated.safetensors
if [ ! -f "$DEST" ] || [ "$(stat -c%s "$DEST" 2>/dev/null || echo 0)" -lt 100000000 ]; then
  for repo in \
    "huihui-ai/Huihui-Qwen3-VL-4B-Instruct-abliterated" \
    "Huihui/Huihui-Qwen3-VL-4B-Instruct-abliterated"
  do
    rm -rf /tmp/huihui_te
    mkdir -p /tmp/huihui_te
    $HF download "$repo" Huihui-Qwen3-VL-4B-Instruct-abliterated.safetensors --local-dir /tmp/huihui_te && break
  done
  found=$(find /tmp/huihui_te /root/.cache/huggingface -name 'Huihui-Qwen3-VL-4B-Instruct-abliterated.safetensors' 2>/dev/null | head -1)
  if [ -n "${found:-}" ]; then
    cp -f "$found" "$DEST"
    echo "OK Huihui CLIP $(stat -c%s "$DEST")"
  elif [ -f /work/ComfyUI/models/text_encoders/qwen3vl_4b_fp8_scaled.safetensors ]; then
    ln -sf qwen3vl_4b_fp8_scaled.safetensors "$DEST"
    echo "CLIP_FALLBACK linked official qwen3vl_4b_fp8"
  fi
fi
echo "PHOTO_READY $(date -Is)"

# Video (MiniMax H3)
dl Comfy-Org/MiniMax-H3 diffusion_models/minimax_h3_fl2va_pruned_fp8_scaled.safetensors \
  /work/ComfyUI/models/diffusion_models/minimax_h3_fl2va_pruned_fp8_scaled.safetensors 1000000000
dl Comfy-Org/MiniMax-H3 diffusion_models/minimax_h3_ref2va_pruned_fp8_scaled.safetensors \
  /work/ComfyUI/models/diffusion_models/minimax_h3_ref2va_pruned_fp8_scaled.safetensors 1000000000
dl Comfy-Org/MiniMax-H3 text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors \
  /work/ComfyUI/models/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors 1000000000
dl Comfy-Org/MiniMax-H3 vae/minimax_h3_video_vae_fp16.safetensors \
  /work/ComfyUI/models/vae/minimax_h3_video_vae_fp16.safetensors 100000000
dl Comfy-Org/MiniMax-H3 vae/minimax_h3_audio_vae_fp32.safetensors \
  /work/ComfyUI/models/vae/minimax_h3_audio_vae_fp32.safetensors 10000000

echo "===== MODELS DONE $(date -Is) ====="
ls -lh /work/ComfyUI/models/diffusion_models/krea2/ || true
ls -lh /work/ComfyUI/models/text_encoders/ || true
ls -lh /work/ComfyUI/models/vae/ || true
ls -lh /work/ComfyUI/models/loras/krea2/ || true
ls -lh /work/ComfyUI/models/diffusion_models/minimax* || true
