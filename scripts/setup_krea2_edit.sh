#!/usr/bin/env bash
set -euxo pipefail
# unload LLM from VRAM
curl -s http://127.0.0.1:11434/api/generate -d '{"model":"gemma4-heretic","keep_alive":0}' >/tmp/ollama_unload.json || true
pkill -f prompt_composer_app.py || true
sleep 2
nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader

mkdir -p /work/ComfyUI/models/loras/krea2
OUT=/work/ComfyUI/models/loras/krea2/krea2_identity_edit_v1_2.safetensors
if [ -f "$OUT" ] && [ "$(stat -c%s "$OUT")" -gt 1000000000 ]; then
  echo "identity lora already present: $(stat -c%s "$OUT") bytes"
else
  echo "downloading identity edit LoRA (~1.83GB)..."
  # try HF first, then mirror
  wget -c -O "$OUT.partial" \
    "https://huggingface.co/conradlocke/krea2-identity-edit/resolve/main/krea2_identity_edit_v1_2.safetensors" \
    || wget -c -O "$OUT.partial" \
    "https://hf-mirror.com/conradlocke/krea2-identity-edit/resolve/main/krea2_identity_edit_v1_2.safetensors"
  mv "$OUT.partial" "$OUT"
fi
ls -lh "$OUT"
ls /work/ComfyUI/custom_nodes/comfyui-krea2edit/workflows/ || true
# pick a source image for smoke
ls -lt /work/ComfyUI/output/krea2/ 2>/dev/null | head -20 || true
ls -lt /work/ComfyUI/input/ 2>/dev/null | head -20 || true
nvidia-smi --query-gpu=memory.used --format=csv,noheader
