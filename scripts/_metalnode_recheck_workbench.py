#!/usr/bin/env python3
"""Full re-check: Comfy up, node registered, actually runnable (queue test with sample clips if present)."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")

REMOTE = r'''#!/bin/bash
set -e
echo "=== COMFY PROCESS ==="
ps aux | grep 'main.py' | grep -v grep || echo NO_COMFY

echo "=== OBJECT INFO ==="
python3 - <<'PY'
import json, urllib.request
data = json.loads(urllib.request.urlopen("http://127.0.0.1:8188/object_info", timeout=30).read())
print("AutoEditWorkbench" in data, "DJ_VideoAudioMixer" in data)
if "AutoEditWorkbench" in data:
    print(json.dumps(data["AutoEditWorkbench"]["input"], ensure_ascii=False)[:1500])
PY

echo "=== moviepy sanity ==="
/work/ai/venv/bin/python -c "from moviepy.editor import VideoFileClip, concatenate_videoclips, ColorClip, CompositeVideoClip; print('editor OK')"
/work/ai/venv/bin/pip show moviepy | grep -i version

echo "=== stitch_inbox contents ==="
mkdir -p /work/ComfyUI/output/stitch_inbox
ls -la /work/ComfyUI/output/stitch_inbox/

echo "=== any test video available? ==="
find /work/ComfyUI/output -iname '*.mp4' 2>/dev/null | head -5
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()
with sftp.file("/work/_recheck.sh", "w") as f:
    f.write(REMOTE)
sftp.close()
stdin, stdout, stderr = c.exec_command("bash /work/_recheck.sh", timeout=60)
print(stdout.read().decode(errors="replace"))
err = stderr.read().decode(errors="replace")
if err.strip():
    print("STDERR:", err[-2000:])
c.close()
