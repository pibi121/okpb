#!/usr/bin/env python3
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (4).txt")
OUT = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\workflows")

FILES = [
    "Flux2_DEPTH_D055_00001_.png",
    "Flux2_DEPTH_D072_00001_.png",
    "Flux2_SKEL_D072_00001_.png",
]

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22024, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()
for fn in FILES:
    try:
        sftp.get(f"/work/ComfyUI/output/{fn}", str(OUT / f"_test_{fn}"))
        print("OK", fn)
    except Exception as e:
        print("FAIL", fn, e)
sftp.close()
c.close()
