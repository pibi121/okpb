#!/usr/bin/env python3
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")

REMOTE = r'''
import subprocess
print("=== which python ===")
print(subprocess.getoutput("/work/ai/venv/bin/python -c 'import sys; print(sys.executable); print(sys.path[:5])'"))
print("=== pip show moviepy ===")
print(subprocess.getoutput("/work/ai/venv/bin/pip show moviepy"))
print("=== try import moviepy ===")
print(subprocess.getoutput("/work/ai/venv/bin/python -c 'import moviepy; print(moviepy.__file__); import moviepy.editor; print(\"editor OK\")'"))
print("=== workbench check code ===")
print(subprocess.getoutput("rg -n 'moviepy|Error' /work/ComfyUI/custom_nodes/ComfyUI-Video-Workbench/video_workbench.py | head -30"))
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()
with sftp.file("/work/_moviepy_debug.py", "w") as f:
    f.write(REMOTE)
sftp.close()
stdin, stdout, stderr = c.exec_command("python3 /work/_moviepy_debug.py", timeout=60)
print(stdout.read().decode(errors="replace"))
print(stderr.read().decode(errors="replace")[-1500:])
c.close()
