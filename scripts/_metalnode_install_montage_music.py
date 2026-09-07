#!/usr/bin/env python3
"""Install Video-Workbench + DJ_VideoAudioMixer; check ACE-Step weights; restart Comfy."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "77.94.203.13"
PORT = 22022
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")
USER = "root"

INSTALL_SH = r'''#!/bin/bash
set -e
cd /work/ComfyUI/custom_nodes

echo "=== CLONE Video-Workbench ==="
if [ -d ComfyUI-Video-Workbench ]; then
  cd ComfyUI-Video-Workbench && git pull --ff-only || true; cd ..
else
  git clone --depth 1 https://github.com/Verolelb/ComfyUI-Video-Workbench.git
fi

echo "=== CLONE DJ_VideoAudioMixer ==="
if [ -d DJ_VideoAudioMixer ]; then
  cd DJ_VideoAudioMixer && git pull --ff-only || true; cd ..
else
  git clone --depth 1 https://github.com/ShmuelRonen/DJ_VideoAudioMixer.git
fi

echo "=== PIP deps if any ==="
VENV=/work/ai/venv/bin/pip
for d in ComfyUI-Video-Workbench DJ_VideoAudioMixer; do
  if [ -f "$d/requirements.txt" ]; then
    echo "pip install -r $d/requirements.txt"
    $VENV install -r "$d/requirements.txt" --quiet || true
  fi
done

echo "=== ACE-STEP MODEL LOOKUP ==="
find /work/ComfyUI/models -iname '*ace*' 2>/dev/null | head -50
ls -lah /work/ComfyUI/models/checkpoints/ 2>/dev/null | head -30
ls -lah /work/ComfyUI/models/diffusion_models/ 2>/dev/null | grep -i ace || true
ls -lah /work/ComfyUI/models/checkpoints/ 2>/dev/null | grep -i ace || true

echo "=== DONE INSTALL ==="
'''


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    client.connect(HOST, port=PORT, username=USER, pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
    sftp = client.open_sftp()
    with sftp.file("/work/_install_montage_music.sh", "w") as f:
        f.write(INSTALL_SH)
    sftp.close()
    stdin, stdout, stderr = client.exec_command("bash /work/_install_montage_music.sh", timeout=300)
    print(stdout.read().decode(errors="replace"))
    err = stderr.read().decode(errors="replace")
    if err.strip():
        print("STDERR:", err[-3000:])
    client.close()


if __name__ == "__main__":
    main()
