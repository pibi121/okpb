#!/usr/bin/env python3
"""Upload patched DJ_VideoAudioMixer (fixes: bgm ignored when no images2/video_info2) and restart Comfy."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")
LOCAL_PATCHED = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\scripts\_dj_mixer_src.py")

RESTART = r'''#!/bin/bash
set -e
cp /work/ComfyUI/custom_nodes/DJ_VideoAudioMixer/video_audio_mixer.py /work/ComfyUI/custom_nodes/DJ_VideoAudioMixer/video_audio_mixer.py.bak_nobgm 2>/dev/null || true
mv /work/ComfyUI/custom_nodes/DJ_VideoAudioMixer/video_audio_mixer.py.new_incoming /work/ComfyUI/custom_nodes/DJ_VideoAudioMixer/video_audio_mixer.py

echo "Syntax check:"
/work/ai/venv/bin/python -m py_compile /work/ComfyUI/custom_nodes/DJ_VideoAudioMixer/video_audio_mixer.py && echo SYNTAX_OK

tmux kill-session -t comfy 2>/dev/null || true
sleep 2
tmux new-session -d -s comfy "/work/bin/start-comfy.sh"

for i in $(seq 1 40); do
  if curl -sf http://127.0.0.1:8188/system_stats >/dev/null 2>&1; then
    echo "COMFY_UP after ${i}s"
    break
  fi
  sleep 2
done
'''


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    client.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
    sftp = client.open_sftp()
    sftp.put(str(LOCAL_PATCHED), "/work/ComfyUI/custom_nodes/DJ_VideoAudioMixer/video_audio_mixer.py.new_incoming")
    with sftp.file("/work/_apply_dj_mixer_patch.sh", "w") as f:
        f.write(RESTART)
    sftp.close()
    stdin, stdout, stderr = client.exec_command("bash /work/_apply_dj_mixer_patch.sh", timeout=90)
    print(stdout.read().decode(errors="replace"))
    err = stderr.read().decode(errors="replace")
    if err.strip():
        print("STDERR:", err[-2000:])
    client.close()


if __name__ == "__main__":
    main()
