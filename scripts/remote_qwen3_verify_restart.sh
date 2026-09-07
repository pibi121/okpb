#!/bin/bash
set -euo pipefail
OUT=/work/ComfyUI/input/tts_qwen3_line.wav
PY=/work/ai/venv/bin/python

echo "=== WAV verify ==="
ls -la "$OUT"
ffprobe -hide_banner -show_streams -show_format "$OUT" 2>&1 | head -40
$PY - <<'PY'
import wave
w=wave.open("/work/ComfyUI/input/tts_qwen3_line.wav")
print("channels", w.getnchannels(), "width", w.getsampwidth(), "rate", w.getframerate(), "frames", w.getnframes(), "dur", w.getnframes()/w.getframerate())
PY

# Install sox for qwen-tts warnings
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq && apt-get install -y -qq sox file 2>&1 | tail -5
file "$OUT"
sox --version | head -1 || true

# Permanent site-wide ROPE patch helper for Suite (official qwen_tts already patches on import)
# Also ensure Suite import path works: create a small sitecustomize or patch note in scripts

# Restart ComfyUI carefully to pick up TTS-Audio-Suite
echo "=== restart ComfyUI ==="
COMFY_PID=$(pgrep -f '/work/ComfyUI/main.py' | head -1 || true)
echo "old pid=$COMFY_PID"
if [ -n "${COMFY_PID:-}" ]; then
  kill "$COMFY_PID" || true
  for i in $(seq 1 30); do
    if ! kill -0 "$COMFY_PID" 2>/dev/null; then break; fi
    sleep 1
  done
  if kill -0 "$COMFY_PID" 2>/dev/null; then
    echo "force kill"
    kill -9 "$COMFY_PID" || true
  fi
fi
sleep 2
cd /work/ComfyUI
nohup /work/ai/venv/bin/python main.py --listen --port 8188 --enable-manager > /tmp/comfyui_restart_qwen3.log 2>&1 &
echo "new pid=$!"
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8188/ || true)
  if [ "$code" = "200" ]; then
    echo "ComfyUI HTTP $code after ${i}s"
    break
  fi
  sleep 2
done
curl -s -o /dev/null -w 'final=%{http_code}\n' http://127.0.0.1:8188/

# Check object_info for Qwen nodes
$PY - <<'PY'
import json, urllib.request
url="http://127.0.0.1:8188/object_info"
try:
    data=json.load(urllib.request.urlopen(url, timeout=60))
except Exception as e:
    print("object_info fail", e)
    raise
keys=[k for k in data if "qwen" in k.lower() or "Qwen" in k]
print("qwen-related nodes:", sorted(keys)[:40], "count", len(keys))
tts=[k for k in data if "TTS" in k or "tts" in k]
print("tts-ish sample:", sorted(tts)[:30])
PY

# Confirm Suite loaded in log
grep -iE 'TTS Audio Suite|Qwen3|error|Error' /tmp/comfyui_restart_qwen3.log | head -40 || true
tail -30 /tmp/comfyui_restart_qwen3.log

echo "=== paths ==="
ls -la /work/ComfyUI/custom_nodes/TTS-Audio-Suite | head -5
ls -la /work/ComfyUI/models/TTS/qwen3_tts/Qwen3-TTS-12Hz-1.7B-Base/model.safetensors
ls -la /work/scripts/qwen3_tts_generate.py
/work/ai/venv/bin/pip show qwen-tts | awk '/^(Name|Version|Location):/'
