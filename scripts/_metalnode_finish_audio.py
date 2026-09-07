#!/usr/bin/env python3
from pathlib import Path
import paramiko
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (2).txt")

SH = r'''#!/bin/bash
set -e
# kill all comfy
pkill -9 -f 'ComfyUI/main.py' || true
pkill -9 -f 'python main.py --listen' || true
sleep 2
fuser -k 8188/tcp 2>/dev/null || true
sleep 2

# Pre-download MuseTalk weights where KJ expects them
# From nodes.py: snapshot_download(repo_id="TMElyralab/MuseTalk", local_dir=model_path)
# Find model_path
python3 - <<'PY'
from pathlib import Path
p = Path("/work/ComfyUI/custom_nodes/ComfyUI-MuseTalk-KJ/nodes.py")
print(p.read_text(encoding="utf-8", errors="ignore")[:4000])
PY

MODEL_DIR=/work/ComfyUI/models/diffusers/TMElyralab/MuseTalk
mkdir -p "$MODEL_DIR"
# try huggingface-cli or snapshot via python
/work/ai/venv/bin/pip install -q huggingface_hub 2>/dev/null || true
/work/ai/venv/bin/python3 - <<'PY'
from huggingface_hub import snapshot_download
from pathlib import Path
dest = Path("/work/ComfyUI/models/diffusers/TMElyralab/MuseTalk")
dest.mkdir(parents=True, exist_ok=True)
try:
    snapshot_download("TMElyralab/MuseTalk", local_dir=str(dest), local_dir_use_symlinks=False)
    print("MUSETALK_DL_OK")
except Exception as e:
    print("MUSETALK_DL_FAIL", e)
# whisper tiny for musetalk
wdir = Path("/work/ComfyUI/models/whisper")
wdir.mkdir(parents=True, exist_ok=True)
w = wdir / "tiny.pt"
if not w.exists() or w.stat().st_size < 10_000_000:
    import urllib.request
    url = "https://openaipublic.azureedge.net/main/whisper/models/65147644a518d12f04e32d6f3b26facc3f8dd46e5390956a9424a650c0ce22b9/tiny.pt"
    print("DL whisper tiny")
    urllib.request.urlretrieve(url, w)
    print("whisper", w.stat().st_size)
else:
    print("whisper OK", w.stat().st_size)
PY

cd /work/ComfyUI
nohup /work/ai/venv/bin/python3 main.py --listen --port 8188 --enable-manager >/work/comfy_restart.log 2>&1 &
echo NEWPID:$!
sleep 20
curl -s -o /dev/null -w "http=%{http_code}\n" http://127.0.0.1:8188/
pgrep -af 'python main.py' | head -3
grep -E 'MMAudio|MuseTalk|Import times|Error|Starting server' /work/comfy_restart.log | tail -40
ls -lh /work/ComfyUI/models/mmaudio/ | head
ls /work/ComfyUI/models/diffusers/TMElyralab/MuseTalk 2>/dev/null | head
ls -lh /work/ComfyUI/input/test_dialogue_moan.mp3
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=40, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()
with sftp.file("/tmp/finish_audio.sh", "w") as f:
    f.write(SH)
sftp.chmod("/tmp/finish_audio.sh", 0o755)
sftp.close()
_, so, se = c.exec_command("bash /tmp/finish_audio.sh", timeout=600)
print(so.read().decode())
err = se.read().decode()
if err.strip():
    print("ERR", err[-1500:])
c.close()
