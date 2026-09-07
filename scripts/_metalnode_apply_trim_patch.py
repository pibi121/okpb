#!/usr/bin/env python3
"""Upload patched video_workbench.py (adds trim_start / trim_start_sec) and restart Comfy via the watchdog-managed tmux session."""
from pathlib import Path
import sys
import time
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")
LOCAL_PATCHED = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\scripts\_video_workbench_ORIG.py")
REMOTE_TARGET = "/work/ComfyUI/custom_nodes/ComfyUI-Video-Workbench/video_workbench.py"
REMOTE_BACKUP = "/work/ComfyUI/custom_nodes/ComfyUI-Video-Workbench/video_workbench.py.bak_pretrim"

RESTART = r'''#!/bin/bash
set -e
echo "Backing up original..."
cp -n /work/ComfyUI/custom_nodes/ComfyUI-Video-Workbench/video_workbench.py.new_incoming /tmp/_check 2>/dev/null || true

# swap in the new file (already uploaded to .new_incoming)
cp /work/ComfyUI/custom_nodes/ComfyUI-Video-Workbench/video_workbench.py /work/ComfyUI/custom_nodes/ComfyUI-Video-Workbench/video_workbench.py.bak_pretrim
mv /work/ComfyUI/custom_nodes/ComfyUI-Video-Workbench/video_workbench.py.new_incoming /work/ComfyUI/custom_nodes/ComfyUI-Video-Workbench/video_workbench.py

echo "Syntax check:"
/work/ai/venv/bin/python -m py_compile /work/ComfyUI/custom_nodes/ComfyUI-Video-Workbench/video_workbench.py && echo SYNTAX_OK

echo "Restarting comfy tmux session (watchdog will notice / we relaunch same way it does)..."
tmux kill-session -t comfy 2>/dev/null || true
sleep 2
tmux new-session -d -s comfy "/work/bin/start-comfy.sh"

for i in $(seq 1 40); do
  if curl -sf http://127.0.0.1:8188/system_stats >/dev/null 2>&1; then
    echo "COMFY_UP after ${i}s"
    break
  fi
  sleep 2
done

python3 - <<'PY'
import json, urllib.request
data = json.loads(urllib.request.urlopen("http://127.0.0.1:8188/object_info/AutoEditWorkbench", timeout=30).read())
inp = data["AutoEditWorkbench"]["input"]
print("required keys:", list(inp.get("required", {}).keys()))
print("has trim_start:", "trim_start" in inp.get("required", {}))
print("has trim_start_sec:", "trim_start_sec" in inp.get("required", {}))
PY
'''


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    client.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)

    sftp = client.open_sftp()
    sftp.put(str(LOCAL_PATCHED), "/work/ComfyUI/custom_nodes/ComfyUI-Video-Workbench/video_workbench.py.new_incoming")
    with sftp.file("/work/_apply_trim_patch.sh", "w") as f:
        f.write(RESTART)
    sftp.close()

    stdin, stdout, stderr = client.exec_command("bash /work/_apply_trim_patch.sh", timeout=120)
    print(stdout.read().decode(errors="replace"))
    err = stderr.read().decode(errors="replace")
    if err.strip():
        print("STDERR:", err[-3000:])
    client.close()


if __name__ == "__main__":
    main()
