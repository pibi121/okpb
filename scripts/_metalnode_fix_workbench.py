#!/usr/bin/env python3
"""Install moviepy for Video-Workbench; soft-restart Comfy; re-verify AutoEditWorkbench."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")

REMOTE = r'''#!/bin/bash
set -e
echo "=== requirements ==="
cat /work/ComfyUI/custom_nodes/ComfyUI-Video-Workbench/requirements.txt

echo "=== pip moviepy ==="
/work/ai/venv/bin/pip install -q 'moviepy>=1.0.3' imageio-ffmpeg 2>&1 | tail -15

echo "=== import again ==="
cd /work/ComfyUI
/work/ai/venv/bin/python - <<'PY'
import sys
sys.path.insert(0, "/work/ComfyUI/custom_nodes/ComfyUI-Video-Workbench")
import video_workbench
print("OK", list(video_workbench.NODE_CLASS_MAPPINGS))
PY

echo "=== restart comfy ==="
tmux kill-session -t comfy 2>/dev/null || true
pkill -f 'main.py --listen --port 8188' || true
sleep 2
/work/bin/run-comfy-tmux.sh
for i in $(seq 1 40); do
  if curl -sf http://127.0.0.1:8188/system_stats >/dev/null; then
    echo COMFY_UP $i
    break
  fi
  sleep 2
done
ps aux | grep 'main.py' | grep -v grep

python3 - <<'PY'
import json, urllib.request
data = json.loads(urllib.request.urlopen("http://127.0.0.1:8188/object_info", timeout=60).read())
print("AutoEditWorkbench", "YES" if "AutoEditWorkbench" in data else "NO")
print("DJ_VideoAudioMixer", "YES" if "DJ_VideoAudioMixer" in data else "NO")
stats = json.loads(urllib.request.urlopen("http://127.0.0.1:8188/system_stats", timeout=10).read())
print("comfyui_version", stats.get("system", {}).get("comfyui_version"))
PY
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()
with sftp.file("/work/_fix_workbench.sh", "w") as f:
    f.write(REMOTE)
sftp.close()
stdin, stdout, stderr = c.exec_command("bash /work/_fix_workbench.sh", timeout=300)
print(stdout.read().decode(errors="replace"))
err = stderr.read().decode(errors="replace")
if err.strip():
    print("STDERR:", err[-2500:])
c.close()
