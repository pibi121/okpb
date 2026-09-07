#!/usr/bin/env python3
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (6).txt")

REMOTE = r'''
echo "=== docker ==="
docker --version 2>/dev/null || echo NO_DOCKER
echo "=== ollama ==="
curl -sf http://127.0.0.1:11434/api/tags | head -c 300; echo
ps aux | grep ollama | grep -v grep
echo "=== ports in use ==="
ss -tlnp | grep -E '8080|3000|11434|8888|8188' || netstat -tlnp 2>/dev/null | grep -E '8080|3000|11434'
echo "=== supervisor ==="
supervisorctl status 2>/dev/null | head -10
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22024, username="root", pkey=pkey, timeout=60, banner_timeout=60, allow_agent=False, look_for_keys=False)
stdin, stdout, stderr = c.exec_command(REMOTE, timeout=30)
print(stdout.read().decode(errors="replace"))
c.close()
