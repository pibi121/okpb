#!/usr/bin/env python3
"""Install ComfyUI-VideoHelperSuite, ensure deps, restart Comfy, verify VHS+MMAudio nodes."""
from __future__ import annotations

import sys
import time
from pathlib import Path

import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (2).txt")

REMOTE = r'''#!/bin/bash
set -e
CN=/work/ComfyUI/custom_nodes
PY=/work/ai/venv/bin/python3
PIP=/work/ai/venv/bin/pip
LOG=/work/VHS_INSTALL.log
exec > >(tee -a "$LOG") 2>&1
echo "[$(date +%H:%M:%S)] START VHS install"

cd "$CN"
if [ ! -d ComfyUI-VideoHelperSuite/.git ]; then
  rm -rf ComfyUI-VideoHelperSuite 2>/dev/null || true
  git clone --depth 1 https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git
else
  echo "VHS repo exists"
  (cd ComfyUI-VideoHelperSuite && git pull --ff-only || true)
fi

if [ -f ComfyUI-VideoHelperSuite/requirements.txt ]; then
  $PIP install -r ComfyUI-VideoHelperSuite/requirements.txt || true
fi
# common deps
$PIP install -q opencv-python-headless imageio imageio-ffmpeg || true
which ffmpeg || apt-get install -y ffmpeg || true

# copy mmaudio example workflow again
mkdir -p /work/ComfyUI/user/default/workflows
cp -f /work/ComfyUI/custom_nodes/ComfyUI-MMAudio/example_workflows/mmaudio_test.json \
  /work/ComfyUI/user/default/workflows/mmaudio_test.json

# hard restart Comfy
echo "restarting Comfy"
pkill -9 -f '/work/ComfyUI/main.py' || true
pkill -9 -f 'python main.py --listen' || true
pkill -9 -f 'python3 main.py --listen' || true
sleep 2
fuser -k 8188/tcp 2>/dev/null || true
sleep 2

cd /work/ComfyUI
nohup $PY main.py --listen --port 8188 --enable-manager >/work/comfy_restart.log 2>&1 &
echo NEWPID:$!

for i in $(seq 1 20); do
  sleep 3
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8188/ || echo 000)
  echo "try$i http=$code"
  if [ "$code" = "200" ]; then
    break
  fi
done

grep -E 'VideoHelper|VHS|MMAudio|Error|Import times|Starting server' /work/comfy_restart.log | tail -40

curl -s http://127.0.0.1:8188/object_info > /tmp/oi.json
$PY - <<'PY'
import json
d=json.load(open("/tmp/oi.json"))
need=["VHS_LoadVideo","VHS_VideoInfo","VHS_VideoCombine","MMAudioSampler","MMAudioModelLoader","MMAudioFeatureUtilsLoader"]
for k in need:
    print(("OK" if k in d else "MISS"), k)
vhs=[k for k in d if k.startswith("VHS_")]
print("VHS_count", len(vhs))
PY

echo DONE
'''

def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    for i in range(5):
        try:
            c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=40, allow_agent=False, look_for_keys=False)
            break
        except Exception as e:
            print("retry", i, e)
            time.sleep(3)
    else:
        raise SystemExit("ssh fail")

    sftp = c.open_sftp()
    with sftp.file("/tmp/install_vhs.sh", "w") as f:
        f.write(REMOTE)
    sftp.chmod("/tmp/install_vhs.sh", 0o755)
    sftp.close()
    _, so, se = c.exec_command("bash /tmp/install_vhs.sh", timeout=300)
    print(so.read().decode())
    err = se.read().decode()
    if err.strip():
        print("ERR", err[-1500:])
    c.close()

if __name__ == "__main__":
    main()
