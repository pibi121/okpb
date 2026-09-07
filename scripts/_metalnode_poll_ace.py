#!/usr/bin/env python3
from pathlib import Path
import sys, paramiko, os
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")
REMOTE = r'''
import os, subprocess
partial="/work/ComfyUI/models/checkpoints/ace_step_1.5_turbo_aio.safetensors.partial"
final="/work/ComfyUI/models/checkpoints/ace_step_1.5_turbo_aio.safetensors"
for p in (final, partial):
  if os.path.exists(p):
    print(f"{p} {os.path.getsize(p)/1e9:.2f}GB")
pid=open("/work/_ace_dl.pid").read().strip() if os.path.exists("/work/_ace_dl.pid") else ""
alive=subprocess.getoutput(f"ps -p {pid} -o pid=").strip() if pid else ""
print("alive", bool(alive))
if os.path.exists(partial) and not alive:
  # finalize if complete (~10.025e9)
  sz=os.path.getsize(partial)
  print("partial size", sz)
  if sz >= 10000000000:
    os.rename(partial, final)
    print("RENAMED to final")
'''
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey=paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
sftp=c.open_sftp(); f=sftp.file("/work/_poll_ace.py","w"); f.write(REMOTE); f.close(); sftp.close()
stdin,stdout,stderr=c.exec_command("python3 /work/_poll_ace.py", timeout=30)
print(stdout.read().decode(errors="replace"))
c.close()
