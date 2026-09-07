#!/bin/bash
export PATH=/usr/bin:/bin
echo "=== dit ==="
ls -lh /work/train/models/flux-2-klein-base-9b-fp8.safetensors* 2>/dev/null || true
pgrep -a curl | head -3 || echo no_curl
tail -c 400 /work/KLEIN_TRAIN_SETUP.log 2>/dev/null | tr '\r' '\n' | tail -5
echo "=== musubi ==="
ls /work/train/musubi-tuner 2>/dev/null | head -10
echo "=== github dns ==="
getent ahostsv4 github.com | head -3
echo "=== dataset ==="
ls /work/datasets/olh_person_klein/images/*.png | wc -l
