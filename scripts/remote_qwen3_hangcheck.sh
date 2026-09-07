#!/bin/bash
set -euo pipefail
# Inspect hung process and suite worker for compile flags
echo "=== process CPU ==="
ps -p 664845 -o pid,etime,%cpu,%mem,cmd 2>/dev/null || echo dead
echo "=== stack sample ==="
timeout 2 py-spy dump --pid 664845 2>/dev/null | head -80 || timeout 2 gdb -batch -p 664845 -ex 'thread apply all bt' 2>/dev/null | head -40 || ls /proc/664845/task | wc -l

echo "=== suite worker rope/compile ==="
grep -n "compile\|ROPE\|default\|fix_mistral" /work/ComfyUI/custom_nodes/TTS-Audio-Suite/utils/runtimes/workers/qwen3_tts_worker.py 2>/dev/null | head -40
grep -n "compile\|ROPE\|default" /work/ComfyUI/custom_nodes/TTS-Audio-Suite/engines/qwen3_tts/qwen3_tts.py 2>/dev/null | head -40
