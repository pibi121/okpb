#!/bin/bash
export PATH=/usr/bin:/bin
echo "=== env ==="
tail -30 /work/KLEIN_MUSUBI_ENV.log 2>/dev/null
pgrep -af 'musubi_env|pip' | head -5
echo "=== dit ==="
ls -lh /work/train/models/
pgrep -a curl | head -2
echo "=== venv ==="
ls /work/train/musubi-tuner/venv/bin/python 2>/dev/null || echo no_venv
