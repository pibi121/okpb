#!/usr/bin/env python3
from pathlib import Path
import paramiko
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (2).txt")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=40, allow_agent=False, look_for_keys=False)
_, so, _ = c.exec_command(
    r"""
echo ===COMFY===
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8188/
echo ===NODES===
curl -s http://127.0.0.1:8188/object_info > /tmp/oi.json
/work/ai/venv/bin/python3 -c "import json;d=json.load(open('/tmp/oi.json'));
print('\n'.join(sorted(k for k in d if any(x in k.lower() for x in ['muse','whisper','tts','audio','loadaudio','vhs_']))))"
echo ===MUSETALK_FILES===
find /work/ComfyUI/models/musetalk -type f 2>/dev/null | head -30
ls -lh /work/ComfyUI/models/whisper/tiny.pt 2>/dev/null
ls -lh /work/ComfyUI/input/test_dialogue_moan.mp3 2>/dev/null
echo ===MUSETALK_NODES_PY===
ls /work/ComfyUI/custom_nodes/ComfyUI-MuseTalk-KJ/
wc -l /work/ComfyUI/custom_nodes/ComfyUI-MuseTalk-KJ/nodes.py
grep -n "NODE_CLASS_MAPPINGS\|class \|RETURN_TYPES\|CATEGORY" /work/ComfyUI/custom_nodes/ComfyUI-MuseTalk-KJ/nodes.py | head -40
echo ===VAE===
ls /work/ComfyUI/models/vae/ | head
echo ===EDGE===
/work/ai/venv/bin/python3 -c "import edge_tts; print('edge_tts_ok')" 2>/dev/null || echo no_edge
""",
    timeout=60,
)
print(so.read().decode())
c.close()
