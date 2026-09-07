#!/usr/bin/env python3
"""Download ACE-Step AIO, inspect node schemas, restart Comfy."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "77.94.203.13"
PORT = 22022
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")
USER = "root"

REMOTE = r'''#!/bin/bash
set -e
OUT=/work/ComfyUI/models/checkpoints/ace_step_1.5_turbo_aio.safetensors
URL="https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files/resolve/main/checkpoints/ace_step_1.5_turbo_aio.safetensors"

echo "=== SIZE ==="
curl -sI -L "$URL" | tr -d '\r' | grep -iE 'HTTP/|content-length|location' | head -20

if [ -f "$OUT" ]; then
  SZ=$(stat -c%s "$OUT")
  echo "EXISTS $OUT size=$SZ"
else
  echo "=== START DOWNLOAD (background) ==="
  nohup curl -L --retry 5 --retry-delay 5 -C - -o "$OUT.partial" "$URL" > /work/_ace_dl.log 2>&1 &
  echo $! > /work/_ace_dl.pid
  echo "PID $(cat /work/_ace_dl.pid)"
fi

echo "=== NODE CLASS NAMES ==="
python3 - <<'PY'
import ast, pathlib
for p in [
  "/work/ComfyUI/custom_nodes/ComfyUI-Video-Workbench/video_workbench.py",
  "/work/ComfyUI/custom_nodes/ComfyUI-Video-Workbench/__init__.py",
  "/work/ComfyUI/custom_nodes/DJ_VideoAudioMixer/video_audio_mixer.py",
  "/work/ComfyUI/custom_nodes/DJ_VideoAudioMixer/__init__.py",
]:
  print("---", p)
  t = pathlib.Path(p).read_text(errors="replace")
  if "NODE_CLASS_MAPPINGS" in t:
    for line in t.splitlines():
      if "NODE_CLASS_MAPPINGS" in line or line.strip().startswith('"') or line.strip().startswith("'"):
        if "NODE" in line or ":" in line and ("Auto" in line or "DJ" in line or "Video" in line or "Workbench" in line or "Mixer" in line):
          print(line[:200])
  for line in t.splitlines():
    if line.startswith("class "):
      print(line[:120])
PY

echo "=== HOW COMFY RUNS ==="
ps aux | grep -E 'main.py|ComfyUI' | grep -v grep | head -10
tmux ls 2>/dev/null || true
ls /etc/supervisor/conf.d/ 2>/dev/null || true
ls /work/*.sh 2>/dev/null | head
'''


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    client.connect(HOST, port=PORT, username=USER, pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
    sftp = client.open_sftp()
    with sftp.file("/work/_ace_dl_start.sh", "w") as f:
        f.write(REMOTE)
    sftp.close()
    stdin, stdout, stderr = client.exec_command("bash /work/_ace_dl_start.sh", timeout=60)
    print(stdout.read().decode(errors="replace"))
    err = stderr.read().decode(errors="replace")
    if err.strip():
        print("STDERR:", err[-2000:])
    client.close()


if __name__ == "__main__":
    main()
