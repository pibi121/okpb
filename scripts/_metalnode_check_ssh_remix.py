#!/usr/bin/env python3
"""Check Metalnode SSH + Wan Remix inventory."""
from __future__ import annotations

import sys
from pathlib import Path

import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (2).txt")
HOST = "77.94.203.13"
USER = "root"

REMOTE = r"""
set -e
echo HOST=$(hostname)
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader || true
echo ---COMFY---
curl -s -o /dev/null -w "comfy_http=%{http_code}\n" http://127.0.0.1:8188/ || echo comfy_http=fail
pgrep -af 'ComfyUI|main.py' | head -5 || true
ss -ltnp 2>/dev/null | grep 8188 || true
echo ---REMIX---
ls -lh /work/ComfyUI/models/diffusion_models/*Remix* 2>/dev/null || echo NO_REMIX_DIT
ls -lh /work/ComfyUI/models/text_encoders/nsfw_wan* 2>/dev/null || echo NO_NSFW_CLIP
ls -lh /work/ComfyUI/models/vae/wan_2.1_vae.safetensors 2>/dev/null || echo NO_WAN_VAE
echo ---STOCK_WAN---
ls -lh /work/ComfyUI/models/diffusion_models/wan2.2_i2v* 2>/dev/null || echo no_stock
echo ---LORAS---
ls -lh /work/ComfyUI/models/loras/olh_person* 2>/dev/null || echo no_lora
echo ---WF---
ls /work/ComfyUI/user/default/workflows/ 2>/dev/null | grep -iE 'wan|remix|video|z-image|klein' || true
echo ---STATUS---
tail -8 /work/SETUP_STATUS.txt 2>/dev/null || echo no_status
df -h /work | tail -1
"""


def try_port(port: int) -> bool:
    print(f"\n=== TRY port {port} ===")
    if not KEY.exists():
        print("KEY_MISSING", KEY)
        return False
    try:
        c = paramiko.SSHClient()
        c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
        c.connect(
            HOST,
            port=port,
            username=USER,
            pkey=pkey,
            timeout=25,
            allow_agent=False,
            look_for_keys=False,
            banner_timeout=30,
        )
        _, so, se = c.exec_command(REMOTE, timeout=45)
        out = so.read().decode("utf-8", "replace")
        err = se.read().decode("utf-8", "replace")
        print(out)
        if err.strip():
            print("STDERR:", err[:800])
        c.close()
        print(f"CONNECTED_OK port={port}")
        return True
    except Exception as e:
        print(f"FAIL port={port}: {type(e).__name__}: {e}")
        return False


def main() -> None:
    print("key", KEY, "exists", KEY.exists())
    ok22 = try_port(22022)
    ok24 = try_port(22024)
    print("\n=== SUMMARY ===")
    print("22022", "OK" if ok22 else "FAIL")
    print("22024", "OK" if ok24 else "FAIL")


if __name__ == "__main__":
    main()
