#!/usr/bin/env python3
"""Poll Eros Max download progress on Metalnode."""
from __future__ import annotations

import json
import time
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
CFG = json.loads((ROOT / "infra" / "metalnode.local.json").read_text(encoding="utf-8"))
TARGETS = {
    "h3ErosMax_beta3_int8_convrot.safetensors": 21_000_000_000,
    "h3ErosMax_beta3.safetensors": 40_000_000_000,
}


def connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(CFG["sshKeyPath"]))
    for i in range(6):
        try:
            c.connect(
                CFG["host"],
                port=int(CFG["sshPort"]),
                username="root",
                pkey=pkey,
                timeout=60,
                banner_timeout=120,
                auth_timeout=60,
                allow_agent=False,
                look_for_keys=False,
            )
            return c
        except Exception:
            time.sleep(3 * (i + 1))
    raise RuntimeError("ssh failed")


def main() -> int:
    while True:
        c = connect()
        try:
            cmd = r"""
cd /work/ComfyUI/models/diffusion_models
echo CURLS:$(pgrep -c curl || echo 0)
for f in h3ErosMax_beta3_int8_convrot.safetensors h3ErosMax_beta3.safetensors; do
  if [[ -f "$f" ]]; then echo DONE $f $(stat -c%s "$f"); 
  elif [[ -f "$f.part" ]]; then echo PART $f $(stat -c%s "$f.part");
  else echo MISS $f; fi
done
"""
            stdin, stdout, stderr = c.exec_command(cmd)
            out = stdout.read().decode("utf-8", "replace")
            print(out, flush=True)
            done = 0
            for name, _approx in TARGETS.items():
                for line in out.splitlines():
                    if line.startswith("DONE ") and name in line:
                        done += 1
            if done >= 2:
                print("ALL_DONE", flush=True)
                return 0
            if done >= 1 and "CURLS:0" in out:
                # one finished, maybe other failed — keep waiting a bit
                pass
        finally:
            c.close()
        time.sleep(30)


if __name__ == "__main__":
    raise SystemExit(main())
