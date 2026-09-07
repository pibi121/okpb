#!/bin/bash
export PATH=/usr/bin:/bin:/usr/local/bin
echo "=== tokens ==="
ls -la /root/.cache/huggingface/ 2>/dev/null | head
cat /root/.cache/huggingface/token 2>/dev/null | head -c 20; echo
env | grep -iE 'HF_|HUGGING' || true
ls /work/hf_cache/hub 2>/dev/null | head -30
echo "=== comfy pid ==="
pgrep -af 'main.py|ComfyUI' | head -5
echo "=== free vram if stop comfy? ==="
# don't stop yet
free -h | head -2
