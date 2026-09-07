#!/usr/bin/env bash
# Install models + custom nodes for MiniMax_H3_Character_Ref2VA share workflow on Metalnode Comfy.
set -euo pipefail

COMFY=/work/ComfyUI
VENV=/work/ai/venv/bin
HF="${HF_ENDPOINT:-https://huggingface.co}"

mkdir -p "$COMFY/models/checkpoints" "$COMFY/models/loras" "$COMFY/custom_nodes"

download() {
  local url="$1" dest="$2"
  if [[ -f "$dest" && $(stat -c%s "$dest" 2>/dev/null || echo 0) -gt 1000000 ]]; then
    echo "OK exists: $(basename "$dest")"
    return 0
  fi
  echo "Downloading $(basename "$dest") ..."
  curl -fL --retry 3 --retry-delay 5 -C - -o "$dest" "$url"
}

# SAM3 for character mask (core SAM3_Detect)
download \
  "$HF/Comfy-Org/sam3.1/resolve/main/checkpoints/sam3.1_multiplex_fp16.safetensors" \
  "$COMFY/models/checkpoints/sam3.1_multiplex_fp16.safetensors"

# Turbo LoRA (8 steps path in share workflow)
download \
  "$HF/drbaph/MiniMax-H3-Turbo-Lora-ComfyUI/resolve/main/minimax_h3_turbo_v4_step600_ema_pruned_comfyui.safetensors" \
  "$COMFY/models/loras/minimax_h3_turbo_v4_step600_ema_pruned_comfyui.safetensors"

# Sol-Attn + MiniMax H3 optimization nodes (Sage chain companion)
if [[ ! -d "$COMFY/custom_nodes/ComfyUI-sol-attn" ]]; then
  echo "Cloning ComfyUI-sol-attn ..."
  git clone --depth 1 https://github.com/Saganaki22/ComfyUI-sol-attn.git "$COMFY/custom_nodes/ComfyUI-sol-attn"
fi
if [[ -f "$COMFY/custom_nodes/ComfyUI-sol-attn/requirements.txt" ]]; then
  "$VENV/pip" install -q -r "$COMFY/custom_nodes/ComfyUI-sol-attn/requirements.txt" || true
fi

echo ""
echo "Already on this GPU (no download):"
ls -lh "$COMFY/models/diffusion_models/minimax_h3_ref2va_pruned_fp8_scaled.safetensors" 2>/dev/null || true
ls -lh "$COMFY/models/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors" 2>/dev/null || true
ls -lh "$COMFY/models/vae/minimax_h3_video_vae_fp16.safetensors" 2>/dev/null || true
ls -lh "$COMFY/models/vae/minimax_h3_audio_vae_fp32.safetensors" 2>/dev/null || true

echo ""
echo "Done. Restart Comfy with Blackwell-safe attention (required for SAM3 on RTX 5090):"
echo "  /work/bin/start-comfy.sh"
echo "  (must include --use-pytorch-cross-attention — see scripts/fix-comfy-blackwell-attn.mjs)"
