#!/bin/bash
set -euo pipefail
pkill -f 'python main.py' 2>/dev/null || true
sleep 2
cd /work/ComfyUI
nohup /work/ai/venv/bin/python main.py --listen --port 8188 --enable-manager --use-pytorch-cross-attention \
  >/work/logs/comfyui.log 2>&1 &
echo "started pid=$!"
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8188/ || true)
  if [ "$code" = "200" ]; then
    echo "ready http=$code"
    exit 0
  fi
  sleep 2
done
echo "FAILED to become ready"; tail -40 /work/logs/comfyui.log; exit 1
