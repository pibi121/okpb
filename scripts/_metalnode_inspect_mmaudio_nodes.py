#!/usr/bin/env python3
from pathlib import Path
import paramiko
import sys
import re

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (2).txt")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=40, allow_agent=False, look_for_keys=False)
_, so, _ = c.exec_command(
    "sed -n '220,270p' /work/ComfyUI/custom_nodes/ComfyUI-MMAudio/nodes.py",
    timeout=20,
)
print(so.read().decode())
# also test load
_, so, se = c.exec_command(
    "cd /work/ComfyUI; /work/ai/venv/bin/python3 -c \""
    "import sys; sys.path.insert(0,'/work/ComfyUI/custom_nodes/ComfyUI-MMAudio'); "
    "from mmaudio.ext.bigvgan_v2.bigvgan import BigVGAN as B; "
    "m=B.from_pretrained('/work/ComfyUI/models/mmaudio/nvidia/bigvgan_v2_44khz_128band_512x'); "
    "print('LOAD_OK', type(m))\""
    ,
    timeout=120,
)
print("LOAD:", so.read().decode())
print("LOADERR:", se.read().decode()[-1500:])
c.close()
