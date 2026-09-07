#!/usr/bin/env python3
"""Patch run-comfy-tmux.sh to use pytorch cross-attention (Blackwell xformers fix)."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")

REMOTE = r'''#!/bin/bash
set -e
F=/work/bin/run-comfy-tmux.sh
echo "=== BEFORE ==="
cat "$F"
cp -a "$F" "$F.bak_before_pytorch_attn"

# Ensure flag present
if grep -q 'use-pytorch-cross-attention' "$F"; then
  echo "flag already present"
else
  # replace main.py launch line
  sed -i 's|main.py --listen --port 8188 --enable-manager|main.py --listen --port 8188 --enable-manager --use-pytorch-cross-attention|g' "$F"
  # also without enable-manager variants
  sed -i 's|main.py --listen --port 8188"|main.py --listen --port 8188 --use-pytorch-cross-attention"|g' "$F"
fi

echo "=== AFTER ==="
cat "$F"

# Also fix watchdog python_alive pattern? optional - patterns still match prefix

echo "=== RESTART ==="
tmux kill-session -t comfy 2>/dev/null || true
pkill -f '/work/ComfyUI/main.py' || true
sleep 2
/work/bin/run-comfy-tmux.sh
sleep 8
for i in $(seq 1 40); do
  if curl -sf http://127.0.0.1:8188/system_stats >/dev/null; then
    echo "COMFY_UP ${i}"
    break
  fi
  sleep 2
done
ps aux | grep 'main.py' | grep -v grep
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()
with sftp.file("/work/_patch_attn.sh", "w") as f:
    f.write(REMOTE)
sftp.close()
stdin, stdout, stderr = c.exec_command("bash /work/_patch_attn.sh", timeout=120)
print(stdout.read().decode(errors="replace"))
err = stderr.read().decode(errors="replace")
if err.strip():
    print("STDERR:", err[-2000:])
c.close()
