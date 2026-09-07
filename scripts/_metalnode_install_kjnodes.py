#!/usr/bin/env python3
from pathlib import Path
import paramiko
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\metalnode_id_ed25519")

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22024, username="root", pkey=pkey, timeout=60, allow_agent=False, look_for_keys=False)
c.get_transport().set_keepalive(20)

_, so, _ = c.exec_command(
    r'''
set -e
CN=/work/ComfyUI/custom_nodes
if [ ! -d "$CN/ComfyUI-KJNodes/.git" ]; then
  rm -rf "$CN/ComfyUI-KJNodes"
  git clone --depth 1 https://github.com/kijai/ComfyUI-KJNodes.git "$CN/ComfyUI-KJNodes"
fi
if [ -f "$CN/ComfyUI-KJNodes/requirements.txt" ]; then
  /work/ai/venv/bin/pip install -q -r "$CN/ComfyUI-KJNodes/requirements.txt" || true
fi
ls -la "$CN/ComfyUI-KJNodes" | head
# soft restart comfy - kill only main.py, leave watchdog
pkill -f "python main.py --listen --port 8188" || true
sleep 2
# watchdog / start tmux
tmux has-session -t comfy 2>/dev/null && tmux kill-session -t comfy || true
tmux new-session -d -s comfy /work/bin/start-comfy.sh
echo restarted
''',
    timeout=180,
)
print(so.read().decode("utf-8", errors="replace"))

for i in range(40):
    _, so, _ = c.exec_command(
        'curl -fsS --max-time 2 http://127.0.0.1:8188/system_stats >/dev/null && echo UP || echo WAIT',
        timeout=15,
    )
    s = so.read().decode().strip()
    print(i, s, flush=True)
    if s == "UP":
        break
    time.sleep(3)

time.sleep(8)

# Verify frontend extensions loaded - check log for KJNodes and whether setget js exists
_, so, _ = c.exec_command(
    r'''
echo '=== kjnodes ==='
ls /work/ComfyUI/custom_nodes/ComfyUI-KJNodes/web/js/ 2>/dev/null | head
grep -n "SetNode\|GetNode" /work/ComfyUI/custom_nodes/ComfyUI-KJNodes/web/js/setgetnodes.js 2>/dev/null | head -10
echo '=== import log ==='
grep -E "KJNodes|Import times|Failed|Error" /work/ComfyUI/user/comfyui_8188.log | tail -n 40
echo '=== object_info Set/Get (backend stubs if any) ==='
/work/ai/venv/bin/python3 - <<'PY'
import urllib.request, json
d=json.loads(urllib.request.urlopen('http://127.0.0.1:8188/system_stats', timeout=30).read())
print('system ok', d.get('system',{}).get('comfyui_version'))
# extensions endpoint if any
try:
    raw=urllib.request.urlopen('http://127.0.0.1:8188/extensions', timeout=30).read()
    ex=json.loads(raw)
    hits=[e for e in ex if 'kj' in e.lower() or 'rgthree' in e.lower() or 'everywhere' in e.lower() or 'setget' in e.lower()]
    print('extensions hits', hits[:30])
    print('total extensions', len(ex))
except Exception as e:
    print('ext err', e)
PY
''',
    timeout=60,
)
print(so.read().decode("utf-8", errors="replace"))
c.close()
