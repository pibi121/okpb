#!/usr/bin/env python3
from pathlib import Path
import paramiko
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (2).txt")
LOCAL = Path(__file__).with_name("_remote_dialogue_poc.sh")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=40, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()
sftp.put(str(LOCAL), "/tmp/dialogue_poc.sh")
sftp.chmod("/tmp/dialogue_poc.sh", 0o755)
sftp.close()
_, so, se = c.exec_command("bash /tmp/dialogue_poc.sh", timeout=600)
print(so.read().decode())
err = se.read().decode()
if err.strip():
    print("ERR", err[-2500:])
c.close()
