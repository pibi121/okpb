#!/usr/bin/env python3
"""Find official ACE-Step template on server / Comfy templates."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")

REMOTE = r'''
import os, glob
patterns = [
 "/work/ComfyUI/**/*ace*",
 "/work/ComfyUI/**/*ACE*",
 "/work/ComfyUI/user/default/workflows/*",
]
seen=set()
for root, dirs, files in os.walk("/work/ComfyUI"):
  if "node_modules" in root or ".git" in root:
    continue
  for f in files:
    fl=f.lower()
    if "ace" in fl and (fl.endswith(".json") or fl.endswith(".safetensors")):
      p=os.path.join(root,f)
      print(p, os.path.getsize(p) if os.path.isfile(p) else "")
  if root.count(os.sep) > 8:
    dirs.clear()
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()
with sftp.file("/work/_find_ace_tpl.py", "w") as f:
    f.write(REMOTE)
sftp.close()
stdin, stdout, stderr = c.exec_command("python3 /work/_find_ace_tpl.py", timeout=60)
print(stdout.read().decode(errors="replace")[:4000])
c.close()
