#!/usr/bin/env python3
"""Use ffmpeg volumedetect to compare loudness of original (no bgm) vs mixed (patched) audio tracks."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")

REMOTE = r'''
echo "=== ORIGINAL (no bgm) volumedetect ==="
ffmpeg -i /work/ComfyUI/output/Stitch/autoedit_00002-audio.mp4 -af "volumedetect" -f null - 2>&1 | grep -E "mean_volume|max_volume"

echo "=== MIXED (patched) volumedetect ==="
ffmpeg -i /work/ComfyUI/output/Final/bgm_patch_verify_00001-audio.mp4 -af "volumedetect" -f null - 2>&1 | grep -E "mean_volume|max_volume"

echo "=== extract both to wav and diff via ffmpeg amerge/astats ==="
ffmpeg -y -i /work/ComfyUI/output/Stitch/autoedit_00002-audio.mp4 -ac 1 -ar 22050 -t 10 /tmp/orig10.wav 2>/dev/null
ffmpeg -y -i /work/ComfyUI/output/Final/bgm_patch_verify_00001-audio.mp4 -ac 1 -ar 22050 -t 10 /tmp/mixed10.wav 2>/dev/null
echo "orig10 stats:"
ffmpeg -i /tmp/orig10.wav -af astats -f null - 2>&1 | grep -E "RMS level|Peak level"
echo "mixed10 stats:"
ffmpeg -i /tmp/mixed10.wav -af astats -f null - 2>&1 | grep -E "RMS level|Peak level"

echo "=== spectral difference check (are they byte-identical audio?) ==="
md5sum /tmp/orig10.wav /tmp/mixed10.wav
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
stdin, stdout, stderr = c.exec_command(REMOTE, timeout=40)
print(stdout.read().decode(errors="replace"))
err = stderr.read().decode(errors="replace")
if err.strip():
    print("STDERR:", err[-2000:])
c.close()
