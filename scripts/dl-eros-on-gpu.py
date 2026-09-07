#!/usr/bin/env python3
"""Download Eros Max beta3 on Metalnode from HuggingFace (fast path)."""
from __future__ import annotations

import json
import time
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
CFG = json.loads((ROOT / "infra" / "metalnode.local.json").read_text(encoding="utf-8"))

REMOTE_DIR = "/work/ComfyUI/models/diffusion_models"
# Same weights as user's local h3ErosMax_beta3.safetensors (~40.2 GB)
BF16_URL = (
    "https://huggingface.co/TenStrip/10Eros-Max/resolve/main/"
    "10Eros_Max_h3_TURBO-hybrid_beta3.safetensors"
)
BF16_NAME = "h3ErosMax_beta3.safetensors"
# Smaller quant for VRAM-friendly tests (~21 GB)
INT8_URL = (
    "https://huggingface.co/TenStrip/10Eros-Max/resolve/main/"
    "10Eros_Max_h3_TURBO-hybrid_beta3_int8_convrot.safetensors"
)
INT8_NAME = "h3ErosMax_beta3_int8_convrot.safetensors"

SCRIPT = f"""#!/bin/bash
set -euo pipefail
mkdir -p {REMOTE_DIR} /work/logs
cd {REMOTE_DIR}

# Drop tiny broken SFTP leftovers (<100MB)
for f in h3ErosMax_beta3.safetensors h3ErosMax_beta3_int8_convrot.safetensors; do
  if [[ -f "$f" ]]; then
    SZ=$(stat -c%s "$f" || echo 0)
    if [[ "$SZ" -lt 100000000 ]]; then
      rm -f "$f"
      echo "removed_tiny $f size=$SZ"
    fi
  fi
done

start_dl() {{
  local url="$1" out="$2"
  if [[ -f "$out" ]]; then
    echo "SKIP complete $out $(stat -c%s "$out")"
    return
  fi
  if pgrep -f "$out.part" >/dev/null 2>&1; then
    echo "ALREADY downloading $out"
    return
  fi
  echo "START $out"
  nohup bash -c '
    set -e
    curl -L --retry 30 --retry-delay 5 -C - --connect-timeout 30 -o "'"$out"'.part" "'"$url"'"
    mv -f "'"$out"'.part" "'"$out"'"
    echo DONE "'"$out"'" $(stat -c%s "'"$out"'")
  ' > "/work/logs/eros_${{out}}.log" 2>&1 &
  echo "PID:$! LOG:/work/logs/eros_${{out}}.log"
}}

start_dl "{INT8_URL}" "{INT8_NAME}"
sleep 1
start_dl "{BF16_URL}" "{BF16_NAME}"
sleep 2
pgrep -a curl | head -10 || true
ls -lh {REMOTE_DIR}/h3ErosMax* 2>/dev/null || true
"""


def main() -> int:
    last_err: Exception | None = None
    for attempt in range(1, 10):
        try:
            c = paramiko.SSHClient()
            c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            pkey = paramiko.Ed25519Key.from_private_key_file(str(CFG["sshKeyPath"]))
            c.connect(
                CFG["host"],
                port=int(CFG["sshPort"]),
                username="root",
                pkey=pkey,
                timeout=90,
                banner_timeout=180,
                auth_timeout=90,
                allow_agent=False,
                look_for_keys=False,
            )
            sftp = c.open_sftp()
            with sftp.file("/work/_dl_eros.sh", "w") as f:
                f.write(SCRIPT)
            sftp.chmod("/work/_dl_eros.sh", 0o755)
            sftp.close()
            stdin, stdout, stderr = c.exec_command("bash /work/_dl_eros.sh")
            print(stdout.read().decode("utf-8", "replace"))
            print(stderr.read().decode("utf-8", "replace"))
            c.close()
            return 0
        except Exception as e:
            last_err = e
            print(f"SSH attempt {attempt}/9 failed: {type(e).__name__}: {e}", flush=True)
            time.sleep(5 * attempt)
    print(f"FAILED: {last_err}", flush=True)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
