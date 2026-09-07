#!/usr/bin/env python3
"""Check Video-Workbench install + AutoEditWorkbench in object_info; restart if missing."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")

REMOTE = r'''#!/bin/bash
set -e
echo "=== NODE DIR ==="
ls -la /work/ComfyUI/custom_nodes/ComfyUI-Video-Workbench/ 2>&1 | head -20

echo "=== COMFY PROCESS ==="
ps aux | grep 'main.py' | grep -v grep || echo "NO_COMFY"

echo "=== OBJECT_INFO ==="
python3 - <<'PY'
import json, urllib.request
try:
    data = json.loads(urllib.request.urlopen("http://127.0.0.1:8188/object_info", timeout=30).read())
    print("AutoEditWorkbench", "YES" if "AutoEditWorkbench" in data else "NO")
    print("DJ_VideoAudioMixer", "YES" if "DJ_VideoAudioMixer" in data else "NO")
    # import errors?
except Exception as e:
    print("API_FAIL", e)
PY

echo "=== IMPORT TEST ==="
cd /work/ComfyUI
/work/ai/venv/bin/python - <<'PY'
import sys
sys.path.insert(0, "/work/ComfyUI")
sys.path.insert(0, "/work/ComfyUI/custom_nodes/ComfyUI-Video-Workbench")
try:
    import video_workbench
    print("import OK", video_workbench.NODE_CLASS_MAPPINGS)
except Exception as e:
    print("import FAIL", repr(e))
PY

echo "=== RECENT LOG (workbench/error) ==="
tail -n 200 /work/ComfyUI/user/comfyui.log 2>/dev/null | grep -iE 'Workbench|Video-Workbench|AutoEdit|Error|Traceback' | tail -40 || true
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()
with sftp.file("/work/_check_workbench.sh", "w") as f:
    f.write(REMOTE)
sftp.close()
stdin, stdout, stderr = c.exec_command("bash /work/_check_workbench.sh", timeout=60)
print(stdout.read().decode(errors="replace"))
err = stderr.read().decode(errors="replace")
if err.strip():
    print("STDERR:", err[-2000:])
c.close()
