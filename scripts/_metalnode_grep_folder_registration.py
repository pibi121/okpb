#!/usr/bin/env python3
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")

CMD = (
    "grep -rn 'folder_names_and_paths\\[.audio.\\]\\|folder_names_and_paths\\[.video.\\]\\|\"audio\"\\] = \\|\"video\"\\] = ' "
    "/work/ComfyUI/folder_paths.py /work/ComfyUI/comfy_extras/*.py /work/ComfyUI/nodes.py 2>/dev/null | head -20"
)

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
stdin, stdout, stderr = c.exec_command(CMD, timeout=15)
print(stdout.read().decode(errors="replace"))
c.close()
