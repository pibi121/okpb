#!/usr/bin/env python3
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")

REMOTE = r'''#!/bin/bash
set -e
echo "=== watchdog script ==="
cat /usr/local/bin/comfy-watchdog.sh
echo
echo "=== current cmdline ==="
ps aux | grep 'main.py' | grep -v grep
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()
with sftp.file("/work/_cat_wd.sh", "w") as f:
    f.write(REMOTE)
sftp.close()
stdin, stdout, stderr = c.exec_command("bash /work/_cat_wd.sh", timeout=30)
print(stdout.read().decode(errors="replace"))
c.close()
