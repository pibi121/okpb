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
    "grep -n 'snapshot_download\\|Missing local BigVGAN\\|bigvgan' /work/ComfyUI/custom_nodes/ComfyUI-MMAudio/nodes.py | head -40; "
    "echo '---'; sed -n '230,255p' /work/ComfyUI/custom_nodes/ComfyUI-MMAudio/nodes.py; "
    "echo '---LOG---'; tail -40 /work/comfy_restart.log",
    timeout=30,
)
print(so.read().decode())
c.close()
