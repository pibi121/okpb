#!/usr/bin/env python3
"""Inspect how Comfy is actually supervised (tmux session name / supervisor / watchdog) before restarting."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")

REMOTE = r'''
echo "=== tmux sessions ==="
tmux ls 2>/dev/null || echo NO_TMUX
echo "=== ps tree ==="
ps -ef | grep -E 'main.py|watchdog|start-comfy' | grep -v grep
echo "=== supervisor ==="
supervisorctl status 2>/dev/null || echo NO_SUPERVISOR
echo "=== start script ==="
cat /work/bin/start-comfy.sh 2>/dev/null || find /work -maxdepth 3 -iname 'start-comfy*' 2>/dev/null
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
stdin, stdout, stderr = c.exec_command(REMOTE, timeout=30)
print(stdout.read().decode(errors="replace"))
c.close()
