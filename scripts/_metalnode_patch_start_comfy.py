#!/usr/bin/env python3
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")

REMOTE = r'''#!/bin/bash
set -e
F=/work/bin/start-comfy.sh
echo "=== BEFORE ==="
cat "$F"
cp -a "$F" "$F.bak_before_pytorch_attn"
if grep -q 'use-pytorch-cross-attention' "$F"; then
  echo "already patched"
else
  sed -i 's|--enable-manager|--enable-manager --use-pytorch-cross-attention|g' "$F"
  # if no enable-manager
  if ! grep -q 'use-pytorch-cross-attention' "$F"; then
    sed -i 's|main.py --listen --port 8188|main.py --listen --port 8188 --use-pytorch-cross-attention|g' "$F"
  fi
fi
echo "=== AFTER ==="
cat "$F"

tmux kill-session -t comfy 2>/dev/null || true
pkill -f 'python main.py --listen --port 8188' || true
sleep 2
# force start even if session check
/work/bin/start-comfy.sh &
# or via run script after ensuring no session
sleep 1
if ! tmux has-session -t comfy 2>/dev/null; then
  /work/bin/run-comfy-tmux.sh
fi
sleep 10
for i in $(seq 1 40); do
  if curl -sf http://127.0.0.1:8188/system_stats >/dev/null; then echo COMFY_UP $i; break; fi
  sleep 2
done
ps aux | grep 'main.py' | grep -v grep
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()
with sftp.file("/work/_patch_start.sh", "w") as f:
    f.write(REMOTE)
sftp.close()
stdin, stdout, stderr = c.exec_command("bash /work/_patch_start.sh", timeout=120)
print(stdout.read().decode(errors="replace"))
err = stderr.read().decode(errors="replace")
if err.strip():
    print("STDERR:", err[-1500:])
c.close()
