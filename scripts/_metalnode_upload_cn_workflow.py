#!/usr/bin/env python3
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (4).txt")
LOCAL = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\workflows\flux2_klein_controlnet_pose_READY.json")
REMOTE = "/work/ComfyUI/user/default/workflows/flux2_klein_controlnet_pose_READY_NOT_WORKING_YET.json"

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22024, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()
sftp.put(str(LOCAL), REMOTE)
sftp.close()
c.close()
print("uploaded", REMOTE)
