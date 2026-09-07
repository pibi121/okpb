#!/usr/bin/env python3
"""Restart ComfyUI tmux session so new custom nodes load."""
from pathlib import Path
import sys
import time
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "77.94.203.13"
PORT = 22022
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")

REMOTE = r'''#!/bin/bash
set -e
echo "Before:"
ps aux | grep 'python main.py' | grep -v grep || true

# Kill comfy process; watchdog should respawn. Prefer tmux kill.
if tmux has-session -t comfy 2>/dev/null; then
  echo "Killing tmux comfy..."
  tmux kill-session -t comfy || true
fi
# also kill leftover
pkill -f '/work/ComfyUI/main.py' || true
sleep 2

# If watchdog exists, wait; else start manually
if [ -f /etc/supervisor/conf.d/comfy-watchdog.conf ]; then
  echo "supervisorctl status:"
  supervisorctl status 2>/dev/null || true
  # try restart watchdog if defined
  supervisorctl restart comfy-watchdog 2>/dev/null || true
fi

sleep 3
# If still no comfy, start tmux manually
if ! pgrep -f '/work/ComfyUI/main.py' >/dev/null; then
  echo "Manual tmux start..."
  tmux new-session -d -s comfy "cd /work/ComfyUI && /work/ai/venv/bin/python main.py --listen --port 8188 --enable-manager"
fi

for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:8188/system_stats >/dev/null; then
    echo "COMFY_UP after ${i}s"
    break
  fi
  sleep 2
done

curl -sf http://127.0.0.1:8188/system_stats | head -c 200; echo
python3 - <<'PY'
import json, urllib.request
data = json.loads(urllib.request.urlopen("http://127.0.0.1:8188/object_info", timeout=60).read())
for pat in ["AutoEditWorkbench", "DJ_VideoAudioMixer", "TextEncodeAceStepAudio1.5", "MiniMaxH3ReferenceToVideo"]:
    print(pat, "YES" if pat in data else "NO")
PY
'''


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    client.connect(HOST, port=PORT, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
    sftp = client.open_sftp()
    with sftp.file("/work/_restart_comfy.sh", "w") as f:
        f.write(REMOTE)
    sftp.close()
    stdin, stdout, stderr = client.exec_command("bash /work/_restart_comfy.sh", timeout=120)
    print(stdout.read().decode(errors="replace"))
    err = stderr.read().decode(errors="replace")
    if err.strip():
        print("STDERR:", err[-2000:])
    client.close()


if __name__ == "__main__":
    main()
