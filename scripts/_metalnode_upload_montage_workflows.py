#!/usr/bin/env python3
"""Upload workflows, mkdir stitch_inbox, update files on server."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")
ROOT = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch")

FILES = [
    ("workflows/stitch_autoedit_READY.json", "/work/ComfyUI/user/default/workflows/stitch_autoedit_READY.json"),
    ("workflows/ace_step_bgm_READY.json", "/work/ComfyUI/user/default/workflows/ace_step_bgm_READY.json"),
    ("workflows/video_bgm_mix_READY.json", "/work/ComfyUI/user/default/workflows/video_bgm_mix_READY.json"),
]

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()
for loc, rem in FILES:
    sftp.put(str(ROOT / loc), rem)
    print("OK", rem)
sftp.close()

stdin, stdout, stderr = c.exec_command(
    "mkdir -p /work/ComfyUI/output/stitch_inbox /work/ComfyUI/input/voice_refs && "
    "ls -lh /work/ComfyUI/models/checkpoints/ace_step_1.5_turbo_aio.safetensors && "
    "ls /work/ComfyUI/user/default/workflows/ | grep -E 'stitch|ace_step|bgm|minimax'",
    timeout=30,
)
print(stdout.read().decode(errors="replace"))
print(stderr.read().decode(errors="replace"))
c.close()
