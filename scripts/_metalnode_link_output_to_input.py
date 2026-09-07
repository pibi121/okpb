#!/usr/bin/env python3
"""Symlink output subfolders into input/, so LoadAudio/VHS_LoadVideo dropdowns can see server-generated files."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")

REMOTE = r'''#!/bin/bash
set -e
cd /work/ComfyUI

mkdir -p output/audio output/video output/Stitch output/Final

for pair in "audio:output_audio" "video:output_video" "Stitch:output_stitch" "Final:output_final"; do
  src="${pair%%:*}"
  dst="${pair##*:}"
  ln -sfn "/work/ComfyUI/output/${src}" "/work/ComfyUI/input/${dst}"
  echo "linked input/${dst} -> output/${src}"
done

echo "=== input/ listing (symlinks) ==="
ls -la /work/ComfyUI/input/ | grep -E 'output_'

echo "=== verify via object_info (live scan, no restart needed) ==="
python3 - <<'PY'
import json, urllib.request
data = json.loads(urllib.request.urlopen("http://127.0.0.1:8188/object_info", timeout=30).read())
audio_opts = data["LoadAudio"]["input"]["required"]["audio"][0]
video_opts = data["VHS_LoadVideo"]["input"]["required"]["video"][0]
print("LoadAudio options containing output_audio:", [o for o in audio_opts if "output_audio" in o])
print("VHS_LoadVideo options containing output_video:", [o for o in video_opts if "output_video" in o][:5])
print("VHS_LoadVideo options containing output_stitch:", [o for o in video_opts if "output_stitch" in o][:5])
PY
'''


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    client.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
    sftp = client.open_sftp()
    with sftp.file("/work/_link_output_to_input.sh", "w") as f:
        f.write(REMOTE)
    sftp.close()
    stdin, stdout, stderr = client.exec_command("bash /work/_link_output_to_input.sh", timeout=40)
    print(stdout.read().decode(errors="replace"))
    err = stderr.read().decode(errors="replace")
    if err.strip():
        print("STDERR:", err[-2000:])
    client.close()


if __name__ == "__main__":
    main()
