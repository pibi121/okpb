#!/usr/bin/env python3
from pathlib import Path
import paramiko
import sys
import json

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (2).txt")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=40, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()
# pull example workflows
remote_ex = "/work/ComfyUI/custom_nodes/ComfyUI-MuseTalk-KJ/example_workflows"
try:
    for name in sftp.listdir(remote_ex):
        print("example:", name)
except Exception as e:
    print("no examples", e)
_, so, _ = c.exec_command(
    "sed -n '47,230p' /work/ComfyUI/custom_nodes/ComfyUI-MuseTalk-KJ/nodes.py; "
    "echo '===='; ls /work/ComfyUI/custom_nodes/ComfyUI-MuseTalk-KJ/example_workflows/ 2>/dev/null; "
    "find /work/ComfyUI/custom_nodes/ComfyUI-MuseTalk-KJ -name '*.json' | head",
    timeout=30,
)
print(so.read().decode()[:8000])
c.close()
