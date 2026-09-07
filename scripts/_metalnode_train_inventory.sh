#!/bin/bash
export PATH=/usr/bin:/bin:/usr/local/bin
echo "=== GPU ==="
nvidia-smi -L
nvidia-smi --query-gpu=memory.total,memory.used,memory.free --format=csv,noheader
echo "=== DISK ==="
df -h /work | tail -1
echo "=== DIFFUSION ==="
ls /work/ComfyUI/models/diffusion_models/ 2>/dev/null | head -40
echo "=== WORK ==="
ls /work | head -40
echo "=== TRAIN ==="
ls -la /work/train 2>/dev/null || echo NO_TRAIN
echo "=== COMFY VENV ==="
/work/ai/venv/bin/python -c 'import torch; print(torch.__version__, torch.cuda.is_available())'
echo "=== PROCS ==="
ps aux | grep -iE 'comfy|train|run.py' | grep -v grep | head -15
echo "=== HF TOKEN? ==="
test -n "$HF_TOKEN" && echo HF_TOKEN_SET || echo HF_TOKEN_UNSET
test -f /root/.cache/huggingface/token && echo HF_TOKEN_FILE || true
ls /work/hf_cache 2>/dev/null | head || true
