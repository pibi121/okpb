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
# start if down
_, so, _ = c.exec_command(
    "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8188/; echo; "
    "pgrep -af 'main.py --listen' | head -3",
    timeout=20,
)
print("before:", so.read().decode())
_, so, _ = c.exec_command(
    "pgrep -f 'main.py --listen' >/dev/null || "
    "(cd /work/ComfyUI && nohup /work/ai/venv/bin/python3 main.py --listen --port 8188 --enable-manager "
    ">/work/comfy_restart.log 2>&1 & echo started); sleep 1; echo ok",
    timeout=15,
)
print(so.read().decode())
time.sleep(20)
_, so, _ = c.exec_command(
    "curl -s -o /dev/null -w 'http=%{http_code}\\n' http://127.0.0.1:8188/; "
    "cp -f /work/ComfyUI/custom_nodes/ComfyUI-MMAudio/example_workflows/mmaudio_test.json "
    "/work/ComfyUI/user/default/workflows/mmaudio_test.json; "
    "curl -s http://127.0.0.1:8188/object_info | /work/ai/venv/bin/python3 - <<'PY'\n"
    "import sys,json\n"
    "d=json.load(sys.stdin)\n"
    "for k in sorted(d):\n"
    "  if 'MMAudio' in k or 'Muse' in k or 'whisper' in k.lower():\n"
    "    print(k)\n"
    "PY",
    timeout=40,
)
print(so.read().decode())
c.close()
