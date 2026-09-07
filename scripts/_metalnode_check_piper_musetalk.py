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
_, so, _ = c.exec_command(
    "grep -iE 'Piper|Error|Traceback|Import' /work/comfy_restart.log | tail -40; "
    "ls /work/ComfyUI/custom_nodes/ComfyUI-PiperTTS/; "
    "head -80 /work/ComfyUI/custom_nodes/ComfyUI-PiperTTS/*.py 2>/dev/null | head -80",
    timeout=30,
)
print(so.read().decode())
# pull example workflow
sftp = c.open_sftp()
local = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\workflows\musetalk_dialogue_example.json")
sftp.get(
    "/work/ComfyUI/user/default/workflows/musetalk_dialogue_example.json",
    str(local),
)
sftp.close()
data = json.loads(local.read_text(encoding="utf-8"))
nodes = data.get("nodes", [])
print("=== WORKFLOW NODES ===")
for n in nodes:
    print(n.get("type"), n.get("title"))
c.close()
