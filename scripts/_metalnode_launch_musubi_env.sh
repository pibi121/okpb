#!/bin/bash
nohup bash /tmp/musubi_env.sh > /work/KLEIN_MUSUBI_ENV.nohup 2>&1 &
echo "ENV_PID:$!"
sleep 2
pgrep -af musubi_env || true
ls -lh /work/train/models/*.part /work/train/models/*.safetensors 2>/dev/null || true
