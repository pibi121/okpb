#!/usr/bin/env python3
from pathlib import Path
import paramiko
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (2).txt")

SH = r'''#!/bin/bash
set +e
echo ===WHO_8188===
ss -ltnp | grep 8188 || netstat -ltnp 2>/dev/null | grep 8188
fuser -v 8188/tcp 2>/dev/null
# kill by port
PID=$(ss -ltnp | grep ':8188' | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1)
echo PID8188=$PID
[ -n "$PID" ] && kill -9 $PID
pkill -9 -f '/work/ComfyUI/main.py'
pkill -9 -f 'python3 main.py'
sleep 3
ss -ltnp | grep 8188 || echo port_free

# MuseTalk path for KJ: /work/ComfyUI/models/musetalk/musetalk/pytorch_model.bin
mkdir -p /work/ComfyUI/models/musetalk
# If partial download in diffusers, move/link
if [ -f /work/ComfyUI/models/diffusers/TMElyralab/MuseTalk/musetalk/pytorch_model.bin ]; then
  cp -a /work/ComfyUI/models/diffusers/TMElyralab/MuseTalk/* /work/ComfyUI/models/musetalk/ 2>/dev/null
  echo copied_from_diffusers
fi
# curl download musetalk unet if missing
DEST=/work/ComfyUI/models/musetalk/musetalk/pytorch_model.bin
mkdir -p /work/ComfyUI/models/musetalk/musetalk
if [ ! -f "$DEST" ] || [ $(stat -c%s "$DEST" 2>/dev/null || echo 0) -lt 100000000 ]; then
  echo DL_MUSETALK_UNET
  # try several mirrors / hf
  curl -L --http1.1 --retry 5 -C - -o "${DEST}.part" \
    "https://huggingface.co/TMElyralab/MuseTalk/resolve/main/musetalk/pytorch_model.bin" \
    && mv "${DEST}.part" "$DEST" && echo UNET_OK || echo UNET_FAIL
fi
ls -lh /work/ComfyUI/models/musetalk/musetalk/ 2>/dev/null | head
# whisper path used by KJ - check code for whisper path
grep -n whisper /work/ComfyUI/custom_nodes/ComfyUI-MuseTalk-KJ/nodes.py | head -20
mkdir -p /work/ComfyUI/models/whisper
ls -lh /work/ComfyUI/models/whisper/tiny.pt 2>/dev/null

cd /work/ComfyUI
rm -f /work/ComfyUI/user/comfyui.db-journal 2>/dev/null
nohup /work/ai/venv/bin/python3 main.py --listen --port 8188 --enable-manager >/work/comfy_restart.log 2>&1 &
echo NEW=$!
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 3
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8188/)
  echo try$i http=$code
  [ "$code" = "200" ] && break
done
pgrep -af 'main.py --listen' | head -3
grep -E 'Import times|MMAudio|MuseTalk|Starting server|Error while|address already' /work/comfy_restart.log | tail -25

# object_info check for nodes
curl -s http://127.0.0.1:8188/object_info 2>/dev/null | /work/ai/venv/bin/python3 -c "
import sys,json
d=json.load(sys.stdin)
keys=[k for k in d if 'mmaudio' in k.lower() or 'muse' in k.lower() or 'MMAudio' in k or 'Muse' in k]
print('NODES', sorted(keys)[:40])
print('count', len(keys))
" 
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=40, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()
with sftp.file("/tmp/fix_comfy_audio.sh", "w") as f:
    f.write(SH)
sftp.chmod("/tmp/fix_comfy_audio.sh", 0o755)
sftp.close()
_, so, se = c.exec_command("bash /tmp/fix_comfy_audio.sh", timeout=600)
print(so.read().decode())
err = se.read().decode()
if err.strip():
    print("ERR", err[-2000:])
c.close()
