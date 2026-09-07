#!/bin/bash
set -uo pipefail
echo "=== tools ==="
which aria2c || true
which huggingface-cli || true
python3 -c 'import huggingface_hub; print("hub", huggingface_hub.__version__)' 2>/dev/null || echo no_hub
echo "=== DNS ==="
getent ahostsv4 us.aws.cdn.hf.co | head -5 || true
getent ahostsv4 cas-bridge.xethub.hf.co | head -5 || true
echo "=== curl ==="
ps -o pid,etime,cmd -C curl 2>/dev/null | head -5 || true
echo "=== files ==="
ls -lh /work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors* 2>/dev/null || true
echo "=== log tail ==="
tail -c 400 /work/REDOWNLOAD_KLEIN_CURL.log 2>/dev/null | tr '\r' '\n' | tail -3
