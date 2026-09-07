#!/usr/bin/env python3
"""Poll quality stack install on Metalnode."""
from __future__ import annotations

import sys
import time
from pathlib import Path

import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (2).txt")


def main() -> None:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=40, allow_agent=False, look_for_keys=False)
    for i in range(40):
        _, so, _ = c.exec_command(
            "echo ===; tail -15 /work/QUALITY_STACK.log 2>/dev/null; echo ---; "
            "ls -lh /work/ComfyUI/models/SEEDVR2/ 2>/dev/null; "
            "ls -lh /work/ComfyUI/models/upscale_models/4x* 2>/dev/null; "
            "test -d /work/ComfyUI/custom_nodes/ComfyUI-Frame-Interpolation && echo VFI_DIR_OK; "
            "pgrep -af install_quality_stack | grep -v grep || echo NO_INSTALLER; "
            "grep -E 'ALL_DONE|FAIL|OK seedvr2_ema_3b_fp8' /work/QUALITY_STACK_STATUS.txt 2>/dev/null || true",
            timeout=30,
        )
        out = so.read().decode()
        print(f"\n--- poll {i} ---")
        print(out)
        if "ALL_DONE" in out or ("NO_INSTALLER" in out and "seedvr2_ema_3b_fp8" in out and "OK" in out):
            if "ALL_DONE" in out:
                break
        if "NO_INSTALLER" in out and i > 2 and "FAIL" in out:
            break
        time.sleep(30)
    c.close()


if __name__ == "__main__":
    main()
