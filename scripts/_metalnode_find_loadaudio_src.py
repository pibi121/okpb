#!/usr/bin/env python3
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")

CMD = r'''
echo "=== find LoadAudio class ==="
grep -rln "class LoadAudio" /work/ComfyUI --include="*.py" 2>/dev/null

echo "=== find VHS_LoadVideo class ==="
grep -rln "class LoadVideo" /work/ComfyUI/custom_nodes/*VideoHelper* --include="*.py" 2>/dev/null
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
stdin, stdout, stderr = c.exec_command(CMD, timeout=20)
print(stdout.read().decode(errors="replace"))
c.close()
