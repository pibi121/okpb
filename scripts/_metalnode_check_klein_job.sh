#!/bin/bash
export PATH=/usr/bin:/bin
PID=a8bd40d8-43a5-4fcd-b187-b36521c30928
echo "=== history ==="
curl -s -m 10 "http://127.0.0.1:8188/history/${PID}" | head -c 2000; echo
echo "=== queue ==="
curl -s -m 5 http://127.0.0.1:8188/queue | head -c 1500; echo
echo "=== imgs ==="
ls -lt /work/ComfyUI/output/klein_test_*.png 2>/dev/null | head -5
echo "=== log tail ==="
tail -40 /work/ComfyUI/user/comfyui_8188.log 2>/dev/null
