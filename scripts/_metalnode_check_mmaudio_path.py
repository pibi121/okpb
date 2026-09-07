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
    "cd /work/ComfyUI; /work/ai/venv/bin/python3 -c \""
    "import sys; sys.path.insert(0,'.'); "
    "import folder_paths; "
    "print('mmaudio_paths', folder_paths.get_folder_paths('mmaudio')); "
    "import os; "
    "p=os.path.join(folder_paths.get_folder_paths('mmaudio')[0],'nvidia','bigvgan_v2_44khz_128band_512x','bigvgan_generator.pt'); "
    "print('gen', p, os.path.isfile(p), os.path.getsize(p) if os.path.isfile(p) else 0)"
    "\"",
    timeout=40,
)
print(so.read().decode())
print(so.channel.recv_stderr(5000).decode() if False else "")
_, se, _ = c.exec_command(
    "cd /work/ComfyUI; /work/ai/venv/bin/python3 -c 'import sys; sys.path.insert(0,\".\"); import folder_paths; print(folder_paths.get_folder_paths(\"mmaudio\"))'",
    timeout=40,
)
# simpler
sftp = c.open_sftp()
with sftp.file("/tmp/check_mm.py", "w") as f:
    f.write(
        "import os, sys\n"
        "sys.path.insert(0, '/work/ComfyUI')\n"
        "os.chdir('/work/ComfyUI')\n"
        "import folder_paths\n"
        "ps = folder_paths.get_folder_paths('mmaudio')\n"
        "print('paths', ps)\n"
        "p = os.path.join(ps[0], 'nvidia', 'bigvgan_v2_44khz_128band_512x', 'bigvgan_generator.pt')\n"
        "print('gen', p, os.path.isfile(p), os.path.getsize(p) if os.path.isfile(p) else 0)\n"
    )
sftp.close()
_, so, se = c.exec_command("cd /work/ComfyUI && /work/ai/venv/bin/python3 /tmp/check_mm.py", timeout=40)
print(so.read().decode())
print(se.read().decode()[-500:])
c.close()
