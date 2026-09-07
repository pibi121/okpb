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
    "cd /work/ComfyUI/output; "
    "/work/ai/venv/bin/python3 -c \""
    "from PIL import Image; import os\n"
    "for n in ['Flux2_upscale_00002_.png','Flux2_dev_00026_.png','Flux2_upscale_00001_.png','Flux2_dev_00025_.png']:\n"
    "  p=n\n"
    "  if not os.path.exists(p): print('miss',n); continue\n"
    "  im=Image.open(p); print(n, im.size, os.path.getsize(p))\n"
    "\"",
    timeout=30,
)
print(so.read().decode())
_, so, _ = c.exec_command(
    "grep -iE 'upscale|UltraSharp|Prompt executed|error|Error' /work/ComfyUI/user/comfyui_8188.log | tail -40",
    timeout=20,
)
print("---user log---")
print(so.read().decode())
c.close()
