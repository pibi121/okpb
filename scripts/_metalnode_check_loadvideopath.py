#!/usr/bin/env python3
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")

CMD = r'''
echo "===== NODE_CLASS_MAPPINGS in load_video_nodes.py ====="
grep -n "NODE_CLASS_MAPPINGS\|LoadVideoPath\|LoadVideoUpload" /work/ComfyUI/custom_nodes/ComfyUI-VideoHelperSuite/videohelpersuite/load_video_nodes.py | head -20

echo "===== LoadVideoPath class body ====="
awk '/class LoadVideoPath/,0' /work/ComfyUI/custom_nodes/ComfyUI-VideoHelperSuite/videohelpersuite/load_video_nodes.py | head -40

echo "===== check object_info for VHS_LoadVideoPath ====="
python3 -c "
import json, urllib.request
data = json.loads(urllib.request.urlopen('http://127.0.0.1:8188/object_info', timeout=30).read())
names = [k for k in data if 'LoadVideo' in k or 'LoadAudio' in k]
print(names)
for n in names:
    inp = data[n]['input'].get('required', {})
    print(n, list(inp.keys()))
"
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
stdin, stdout, stderr = c.exec_command(CMD, timeout=20)
print(stdout.read().decode(errors="replace"))
c.close()
