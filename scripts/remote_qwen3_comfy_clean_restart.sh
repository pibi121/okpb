#!/bin/bash
set -euo pipefail
export PYTHONUNBUFFERED=1

echo "=== kill all ComfyUI main.py ==="
# Do NOT kill jupyter or other python
pgrep -af 'main.py --listen --port 8188' || true
for p in $(pgrep -f 'main.py --listen --port 8188' || true); do
  echo "TERM $p"
  kill "$p" || true
done
for i in $(seq 1 40); do
  left=$(pgrep -f 'main.py --listen --port 8188' || true)
  if [ -z "$left" ]; then break; fi
  sleep 1
done
left=$(pgrep -f 'main.py --listen --port 8188' || true)
if [ -n "$left" ]; then
  echo "KILL -9 $left"
  kill -9 $left || true
fi
sleep 2
pgrep -af 'main.py --listen' || echo 'no comfy left'

# Free port check via python
/work/ai/venv/bin/python - <<'PY'
import socket
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    s.bind(('0.0.0.0', 8188))
    print('port 8188 free')
except OSError as e:
    print('port busy', e)
finally:
    s.close()
PY

cd /work/ComfyUI
rm -f /tmp/comfyui_qwen3_clean.log
nohup /work/ai/venv/bin/python main.py --listen --port 8188 --enable-manager > /tmp/comfyui_qwen3_clean.log 2>&1 &
echo "started pid=$!"

ok=0
for i in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8188/ || true)
  if [ "$code" = "200" ]; then
    # wait until Suite finished loading (log marker)
    if grep -q 'TTS Audio Suite v5' /tmp/comfyui_qwen3_clean.log 2>/dev/null; then
      echo "ready after ${i}s http=$code"
      ok=1
      break
    fi
  fi
  sleep 2
done
if [ "$ok" != "1" ]; then
  echo "WARN: may still be loading"
  tail -40 /tmp/comfyui_qwen3_clean.log
fi

/work/ai/venv/bin/python - <<'PY'
import json, urllib.request, time
for attempt in range(10):
    try:
        data=json.load(urllib.request.urlopen('http://127.0.0.1:8188/object_info', timeout=120))
        break
    except Exception as e:
        print('retry object_info', e)
        time.sleep(3)
else:
    raise SystemExit('object_info failed')
q=[k for k in data if 'Qwen3' in k or 'qwen3' in k]
print('Qwen3 nodes:', sorted(q))
assert any('Qwen3TTS' in k for k in data), 'Qwen3TTS engine node missing!'
print('OK Comfy has Qwen3TTS')
print('http root', urllib.request.urlopen('http://127.0.0.1:8188/').status)
PY

echo "=== single process? ==="
pgrep -af 'main.py --listen --port 8188'
curl -s -o /dev/null -w 'http=%{http_code}\n' http://127.0.0.1:8188/
grep -E 'Qwen3-TTS Engine|TTS Audio Suite v5|not installed correctly' /tmp/comfyui_qwen3_clean.log | head -20
