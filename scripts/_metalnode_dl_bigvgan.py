#!/usr/bin/env python3
"""Pre-download MMAudio BigVGAN (+ check what snapshot_download needs) so Hub DNS is not required."""
from __future__ import annotations

import sys
import time
from pathlib import Path

import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (2).txt")

REMOTE = r'''#!/bin/bash
set -e
LOG=/work/MMAUDIO_BIGVGAN.log
exec > >(tee -a "$LOG") 2>&1
echo "[$(date +%H:%M:%S)] START"

# Show what MMAudio tries to download
grep -n "snapshot_download\|repo_id\|bigvgan\|nvidia" /work/ComfyUI/custom_nodes/ComfyUI-MMAudio/nodes.py | head -40

DEST=/work/ComfyUI/models/mmaudio/nvidia/bigvgan_v2_44khz_128band_512x
mkdir -p "$DEST"

# Resolve HF IP (avoid broken DNS)
HF_IP=$(getent ahostsv4 huggingface.co | awk '{print $1; exit}')
echo "HF_IP=$HF_IP"
if [ -z "$HF_IP" ]; then
  # fallback known / dig
  HF_IP=$(dig +short huggingface.co A | head -1)
fi
echo "HF_IP2=$HF_IP"

dl() {
  local url="$1"
  local out="$2"
  local min="${3:-1000}"
  if [ -f "$out" ] && [ "$(stat -c%s "$out")" -ge "$min" ]; then
    echo "OK exists $(basename "$out") $(stat -c%s "$out")"
    return 0
  fi
  echo "DL $(basename "$out")"
  local part="${out}.part"
  if [ -n "$HF_IP" ]; then
    curl -L --http1.1 --retry 8 --retry-delay 2 -C - \
      --resolve "huggingface.co:443:$HF_IP" \
      --resolve "cdn-lfs.huggingface.co:443:$HF_IP" \
      -o "$part" "$url" || true
  else
    curl -L --http1.1 --retry 8 --retry-delay 2 -C - -o "$part" "$url" || true
  fi
  # try hf-cdn with getent
  if [ ! -f "$part" ] || [ "$(stat -c%s "$part" 2>/dev/null || echo 0)" -lt "$min" ]; then
    echo "retry plain curl"
    curl -L --http1.1 --retry 5 -C - -o "$part" "$url"
  fi
  mv "$part" "$out"
  echo "OK $(basename "$out") $(stat -c%s "$out")"
}

BASE="https://huggingface.co/nvidia/bigvgan_v2_44khz_128band_512x/resolve/main"

# List remote files via API if possible
curl -sL "https://huggingface.co/api/models/nvidia/bigvgan_v2_44khz_128band_512x/tree/main" | head -c 2000 || true
echo

# Common files for BigVGAN v2
dl "$BASE/config.json" "$DEST/config.json" 100
dl "$BASE/bigvgan_generator.pt" "$DEST/bigvgan_generator.pt" 10000000 || \
dl "$BASE/bigvgan_generator_best.pt" "$DEST/bigvgan_generator_best.pt" 10000000 || true

# Some releases use different names - try python hub with offline after manual
/work/ai/venv/bin/python3 - <<'PY'
import os, json, urllib.request
from pathlib import Path
dest = Path("/work/ComfyUI/models/mmaudio/nvidia/bigvgan_v2_44khz_128band_512x")
dest.mkdir(parents=True, exist_ok=True)
api = "https://huggingface.co/api/models/nvidia/bigvgan_v2_44khz_128band_512x/tree/main"
try:
    data = json.loads(urllib.request.urlopen(api, timeout=60).read().decode())
except Exception as e:
    print("API fail", e)
    data = []
print("files", [x.get("path") for x in data if isinstance(x, dict)])
for item in data:
    if not isinstance(item, dict) or item.get("type") != "file":
        continue
    path = item["path"]
    size = item.get("size") or 0
    out = dest / path
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists() and out.stat().st_size >= max(size * 0.9 if size else 1, 1):
        print("skip", path, out.stat().st_size)
        continue
    url = f"https://huggingface.co/nvidia/bigvgan_v2_44khz_128band_512x/resolve/main/{path}"
    print("get", path, size)
    urllib.request.urlretrieve(url, out)
    print("ok", path, out.stat().st_size)
PY

echo "=== DEST ==="
find "$DEST" -type f -printf '%s %p\n' | head -30

# Also check nodes.py for exact local_dir expected
/work/ai/venv/bin/python3 - <<'PY'
from pathlib import Path
t = Path("/work/ComfyUI/custom_nodes/ComfyUI-MMAudio/nodes.py").read_text(encoding="utf-8", errors="ignore")
for i,line in enumerate(t.splitlines(),1):
    if "snapshot_download" in line or "bigvgan" in line.lower() or "local_dir" in line:
        if i>200 and i<280:
            print(f"{i}: {line}")
# print surrounding loadmodel FeatureUtils
idx = t.find("snapshot_download")
print("---ctx---")
print(t[idx-200:idx+400] if idx>=0 else "none")
PY

echo DONE
'''

def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=40, allow_agent=False, look_for_keys=False)
    sftp = c.open_sftp()
    with sftp.file("/tmp/dl_bigvgan.sh", "w") as f:
        f.write(REMOTE)
    sftp.chmod("/tmp/dl_bigvgan.sh", 0o755)
    sftp.close()
    _, so, se = c.exec_command("bash /tmp/dl_bigvgan.sh", timeout=600)
    print(so.read().decode())
    err = se.read().decode()
    if err.strip():
        print("ERR", err[-2000:])
    c.close()

if __name__ == "__main__":
    main()
