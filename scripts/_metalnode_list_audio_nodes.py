#!/usr/bin/env python3
from pathlib import Path
import paramiko
import json
import sys
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (2).txt")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=40, allow_agent=False, look_for_keys=False)
_, so, _ = c.exec_command(
    "curl -s http://127.0.0.1:8188/object_info > /tmp/oi.json; "
    "/work/ai/venv/bin/python3 -c \"import json; d=json.load(open('/tmp/oi.json')); "
    "print('\\n'.join(sorted(k for k in d if 'MMAudio' in k or 'Muse' in k or 'whisper' in k.lower())))\"; "
    "ls /work/ComfyUI/user/default/workflows/mmaudio_test.json; "
    "ls -lh /work/ComfyUI/models/musetalk/musetalk/pytorch_model.bin; "
    "ls -lh /work/ComfyUI/input/test_dialogue_moan.mp3",
    timeout=60,
)
print(so.read().decode())
c.close()
