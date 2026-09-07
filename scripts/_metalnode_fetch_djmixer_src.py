#!/usr/bin/env python3
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()
sftp.get(
    "/work/ComfyUI/custom_nodes/DJ_VideoAudioMixer/video_audio_mixer.py",
    str(Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\scripts\_dj_mixer_src.py")),
)
sftp.close()
c.close()
print("OK")
