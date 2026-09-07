#!/usr/bin/env python3
from pathlib import Path
import paramiko
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (2).txt")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=40, allow_agent=False, look_for_keys=False)
_, so, _ = c.exec_command(
    "ls -lt /work/ComfyUI/user/comfyui_8188.log /work/comfy_restart.log 2>/dev/null; "
    "echo '==== comfyui_8188 last 150 ===='; "
    "tail -150 /work/ComfyUI/user/comfyui_8188.log; "
    "echo '==== grep errors ===='; "
    "grep -iE 'Error|Traceback|Exception|OOM|SeedVR|out of memory|CUDA|Failed|RuntimeError' "
    "/work/ComfyUI/user/comfyui_8188.log | tail -60; "
    "echo '==== restart log tail ===='; "
    "tail -100 /work/comfy_restart.log",
    timeout=45,
)
print(so.read().decode())
c.close()
