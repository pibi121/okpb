#!/usr/bin/env python3
from pathlib import Path
import paramiko
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (2).txt")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=40, allow_agent=False, look_for_keys=False)
_, so, _ = c.exec_command(
    "pkill -9 -f '/work/ComfyUI/main.py' || true; sleep 2; "
    "cd /work/ComfyUI && nohup /work/ai/venv/bin/python3 main.py --listen --port 8188 --enable-manager "
    ">/work/comfy_restart.log 2>&1 & echo PID:$!",
    timeout=20,
)
print(so.read().decode())
time.sleep(18)
_, so, _ = c.exec_command(
    "curl -s -o /dev/null -w 'http=%{http_code}\\n' http://127.0.0.1:8188/; "
    "grep -E 'MMAudio|Starting server|Error' /work/comfy_restart.log | tail -15",
    timeout=30,
)
print(so.read().decode())
c.close()
