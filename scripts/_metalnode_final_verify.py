#!/usr/bin/env python3
from pathlib import Path
import paramiko, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (1).txt")
c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22024, username="root", pkey=pkey, timeout=90, allow_agent=False, look_for_keys=False, banner_timeout=90)
_, so, _ = c.exec_command(r"""
ls -lh /work/ComfyUI/models/loras/olh_person_klein.safetensors /work/loras_out/olh_person_klein/*.safetensors
echo ---
pgrep -af 'main.py --listen' || echo COMFY_DOWN
curl -s -o /dev/null -w 'HTTP:%{http_code}\n' http://127.0.0.1:8188/ || true
tail -5 /work/loras_out/olh_person_klein_train.log
""", timeout=30)
print(so.read().decode())
c.close()
