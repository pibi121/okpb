#!/usr/bin/env python3
from pathlib import Path
import paramiko
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (2).txt")

REMOTE = r"""
set -e
pgrep -af 'main.py' | head -5 || true
# kill comfy main
pkill -f '/work/ComfyUI/main.py' || pkill -f 'python main.py' || true
sleep 2
cd /work/ComfyUI
nohup /work/ai/venv/bin/python3 main.py --listen --port 8188 --enable-manager > /work/comfy_restart.log 2>&1 &
echo STARTED_PID:$!
sleep 8
curl -s -o /dev/null -w "http=%{http_code}\n" http://127.0.0.1:8188/ || true
ls /work/ComfyUI/custom_nodes/ComfyUI-Frame-Interpolation | head -5
ls -lh /work/ComfyUI/models/SEEDVR2/
ls -lh /work/ComfyUI/models/upscale_models/4x-UltraSharp.pth
"""

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=40, allow_agent=False, look_for_keys=False)
_, so, se = c.exec_command(REMOTE, timeout=60)
print(so.read().decode())
err = se.read().decode()
if err.strip():
    print("ERR", err[-500:])
time.sleep(15)
_, so, _ = c.exec_command('curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8188/; echo; pgrep -af main.py | head -3', timeout=30)
print("after:", so.read().decode())
c.close()
