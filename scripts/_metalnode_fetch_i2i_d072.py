#!/usr/bin/env python3
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (4).txt")

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22024, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()
sftp.get("/work/ComfyUI/output/Flux2_I2I_TEST_D072_00001_.png", r"C:\Users\Олег\Desktop\Проект Х\peachbitch\workflows\_test_i2i_result_d072.png")
sftp.close()
c.close()
print("done")
