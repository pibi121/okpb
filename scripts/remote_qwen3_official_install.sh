#!/bin/bash
set -euo pipefail
# Kill hung gen carefully (do not touch ComfyUI main.py / jupyter)
if [ -d /proc/664845 ]; then
  echo "killing hung gen pid 664845"
  kill 664845 2>/dev/null || true
  sleep 2
  kill -9 664845 2>/dev/null || true
fi
pkill -f '/tmp/remote_qwen3_gen_v2.sh' 2>/dev/null || true
sleep 1
nvidia-smi --query-compute-apps=pid,used_memory,process_name --format=csv
curl -s -o /dev/null -w 'comfy=%{http_code}\n' http://127.0.0.1:8188/

PIP=/work/ai/venv/bin/pip
PY=/work/ai/venv/bin/python

echo "=== install official qwen-tts ==="
$PIP install -q 'qwen-tts==0.1.1'
$PY - <<'PY'
import qwen_tts, inspect, os
print("qwen_tts", qwen_tts.__file__)
from qwen_tts import Qwen3TTSModel
print("methods ok", hasattr(Qwen3TTSModel, "generate_voice_clone"))
# check if bundled rope still has KeyError risk
import transformers.modeling_rope_utils as m
print("ROPE keys", sorted(m.ROPE_INIT_FUNCTIONS.keys()))
PY
