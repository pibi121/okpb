#!/usr/bin/env python3
from pathlib import Path
import paramiko
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (2).txt")

REMOTE = r"""
echo ===PROCS===
pgrep -af 'python main.py' | head -5
echo ===LOG_FILES===
ls -lt /work/comfy*.log /work/ComfyUI/user/*.log 2>/dev/null | head -10
ls -lt /work/*.log 2>/dev/null | head -15
echo ===RECENT_OUTPUT===
ls -lt /work/ComfyUI/output/ 2>/dev/null | head -25
echo ===GREP_ERRORS===
for f in /work/comfy_restart.log /work/ComfyUI/comfyui.log /tmp/comfy*.log; do
  [ -f "$f" ] || continue
  echo "-- $f --"
  grep -iE 'error|exception|traceback|oom|out of memory|upscale|UltraSharp|CUDA|Failed' "$f" 2>/dev/null | tail -40
done
echo ===TAIL_RESTART===
tail -80 /work/comfy_restart.log 2>/dev/null
echo ===JOURNAL===
# also check if stdout went elsewhere
ls -lt /proc/$(pgrep -n -f 'python main.py')/fd/1 2>/dev/null
tr '\0' ' ' < /proc/$(pgrep -n -f 'python main.py')/cmdline 2>/dev/null; echo
"""

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=40, allow_agent=False, look_for_keys=False)
_, so, se = c.exec_command(REMOTE, timeout=45)
print(so.read().decode())
err = se.read().decode()
if err.strip():
    print("STDERR", err[-500:])
c.close()
