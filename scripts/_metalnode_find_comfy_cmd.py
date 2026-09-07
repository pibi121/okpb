#!/usr/bin/env python3
"""Fix Comfy launch for Blackwell: --use-pytorch-cross-attention; find watchdog cmd."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")

REMOTE = r'''#!/bin/bash
set -e
echo "=== watchdog conf ==="
cat /etc/supervisor/conf.d/comfy-watchdog.conf
echo
echo "=== find start scripts ==="
rg -n "main.py|listen|8188" /work --glob '*.sh' --glob '*.conf' --glob '*.py' 2>/dev/null | head -40
ls /work/scripts 2>/dev/null | head
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()
with sftp.file("/work/_find_comfy_cmd.sh", "w") as f:
    f.write(REMOTE)
sftp.close()
stdin, stdout, stderr = c.exec_command("bash /work/_find_comfy_cmd.sh", timeout=30)
print(stdout.read().decode(errors="replace"))
print(stderr.read().decode(errors="replace")[-1500:])
c.close()
