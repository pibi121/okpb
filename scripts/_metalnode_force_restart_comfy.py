#!/usr/bin/env python3
from pathlib import Path
import paramiko
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (2).txt")

SH = r"""#!/bin/bash
set -e
pgrep -af 'python main.py' || true
kill $(pgrep -f 'python main.py --listen') 2>/dev/null || true
sleep 3
cd /work/ComfyUI
nohup /work/ai/venv/bin/python3 main.py --listen --port 8188 --enable-manager >/work/comfy_restart.log 2>&1 &
echo NEWPID:$!
sleep 15
curl -s -o /dev/null -w "http=%{http_code}\n" http://127.0.0.1:8188/
pgrep -af 'python main.py' | head -5
grep -iE 'error|Frame-Interpolation|SeedVR|Import' /work/comfy_restart.log | tail -20 || true
"""

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=40, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()
with sftp.file("/tmp/restart_comfy.sh", "w") as f:
    f.write(SH)
sftp.chmod("/tmp/restart_comfy.sh", 0o755)
sftp.close()
_, so, se = c.exec_command("bash /tmp/restart_comfy.sh", timeout=90)
print(so.read().decode())
err = se.read().decode()
if err.strip():
    print("ERR", err[-1000:])
c.close()
