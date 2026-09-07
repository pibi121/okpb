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
    # kill older duplicate, keep newest
    "ps -o pid,lstart,cmd -C python,python3 2>/dev/null | grep main.py; "
    "pgrep -af 'main.py --listen'; "
    "kill -9 437160 2>/dev/null; sleep 2; "
    "curl -s -o /dev/null -w 'http=%{http_code}\\n' http://127.0.0.1:8188/; "
    "curl -s http://127.0.0.1:8188/object_info | /work/ai/venv/bin/python3 -c \""
    "import sys,json; d=json.load(sys.stdin); "
    "ks=sorted(k for k in d if any(x in k.lower() for x in ['mmaudio','muse','whisper','vocoder'])); "
    "print('\\n'.join(ks)); print('N',len(ks))"
    "\"; "
    "ls /work/ComfyUI/models/vae 2>/dev/null | head; "
    "ls /work/ComfyUI/custom_nodes/ComfyUI-MMAudio/example_workflows 2>/dev/null; "
    "ls /work/ComfyUI/custom_nodes/ComfyUI-MMAudio/*.json 2>/dev/null; "
    "find /work/ComfyUI/custom_nodes/ComfyUI-MMAudio -name '*.json' | head",
    timeout=45,
)
print(so.read().decode())
c.close()
