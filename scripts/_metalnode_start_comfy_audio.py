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
    "cd /work/ComfyUI && nohup /work/ai/venv/bin/python3 main.py --listen --port 8188 --enable-manager >/work/comfy_restart.log 2>&1 & echo PID:$!; "
    "sleep 18; curl -s -o /dev/null -w 'http=%{http_code}\\n' http://127.0.0.1:8188/; "
    "cp -n /work/ComfyUI/custom_nodes/ComfyUI-MMAudio/example_workflows/mmaudio_test.json "
    "/work/ComfyUI/user/default/workflows/mmaudio_test.json; "
    "curl -s http://127.0.0.1:8188/object_info | /work/ai/venv/bin/python3 -c \""
    "import sys,json; d=json.load(sys.stdin); "
    "ks=sorted(k for k in d if any(x in k for x in ['MMAudio','Muse','whisper'])); "
    "print('NODES:'); [print(k) for k in ks]"
    "\"; "
    "ls -lh /work/ComfyUI/input/test_dialogue_moan.mp3; "
    "ls /work/ComfyUI/output/video 2>/dev/null | tail -5",
    timeout=60,
)
print(so.read().decode())
c.close()
