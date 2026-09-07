#!/usr/bin/env python3
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")

CMD = r'''
echo "===== VHS nodes.py LoadAudio (INPUT_TYPES) ====="
awk '/class LoadAudio/,/^class /' /work/ComfyUI/custom_nodes/ComfyUI-VideoHelperSuite/videohelpersuite/nodes.py | head -40

echo "===== VHS load_video_nodes.py LoadVideo (INPUT_TYPES) ====="
awk '/class LoadVideoUpload|class LoadVideoPath/,/^class /' /work/ComfyUI/custom_nodes/ComfyUI-VideoHelperSuite/videohelpersuite/load_video_nodes.py | head -60

echo "===== search for recursive/glob helper used ====="
grep -n "def get_video_formats\|def get_audio_formats\|def strip_path\|recursive\|os.walk\|listdir" /work/ComfyUI/custom_nodes/ComfyUI-VideoHelperSuite/videohelpersuite/*.py | head -30
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
stdin, stdout, stderr = c.exec_command(CMD, timeout=20)
print(stdout.read().decode(errors="replace"))
c.close()
