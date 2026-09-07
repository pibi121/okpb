#!/usr/bin/env python3
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")

REMOTE = r'''
/work/ai/venv/bin/python -c "
from moviepy.editor import VideoFileClip
for p in ['/work/ComfyUI/output/Stitch/trimtest_off_00001-audio.mp4', '/work/ComfyUI/output/Stitch/trimtest_on_00001-audio.mp4']:
    c = VideoFileClip(p)
    print(p, 'duration=', round(c.duration, 2), 's')
    c.close()
"
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
stdin, stdout, stderr = c.exec_command(REMOTE, timeout=30)
print(stdout.read().decode(errors="replace"))
err = stderr.read().decode(errors="replace")
if err.strip():
    print("STDERR:", err[-1500:])
c.close()
