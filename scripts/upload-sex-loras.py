#!/usr/bin/env python3
"""Upload sex LoRAs to Metalnode Comfy models/loras/minimax/."""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
CFG = json.loads((ROOT / "infra" / "metalnode.local.json").read_text(encoding="utf-8"))

FILES = [
    (
        Path(r"C:\Users\Олег\Downloads\HMNSFW_AIO_V2.safetensors"),
        "/work/ComfyUI/models/loras/minimax/HMNSFW_AIO_V2.safetensors",
    ),
    (
        Path(r"C:\Users\Олег\Downloads\furry_lora_epoch31.safetensors"),
        "/work/ComfyUI/models/loras/minimax/furry_lora_epoch31.safetensors",
    ),
]


def connect() -> paramiko.SSHClient:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(CFG["sshKeyPath"]))
    c.connect(
        CFG["host"],
        port=int(CFG["sshPort"]),
        username=str(CFG.get("sshUser") or "root"),
        pkey=pkey,
        timeout=120,
        banner_timeout=120,
        auth_timeout=120,
        allow_agent=False,
        look_for_keys=False,
    )
    t = c.get_transport()
    if t:
        t.set_keepalive(15)
    return c


def main() -> int:
    c = connect()
    try:
        stdin, stdout, stderr = c.exec_command("mkdir -p /work/ComfyUI/models/loras/minimax")
        stdout.channel.recv_exit_status()
        sftp = c.open_sftp()
        try:
            for local, remote in FILES:
                if not local.exists():
                    print(f"MISSING {local}", flush=True)
                    return 1
                # skip if same size already present
                try:
                    st = sftp.stat(remote)
                    if st.st_size == local.stat().st_size:
                        print(f"SKIP exists {remote} ({st.st_size})", flush=True)
                        continue
                except FileNotFoundError:
                    pass
                print(f"UPLOAD {local.name} -> {remote} ({local.stat().st_size} bytes)", flush=True)
                t0 = time.time()
                sftp.put(str(local), remote)
                print(f"OK {remote} in {time.time()-t0:.1f}s", flush=True)
        finally:
            sftp.close()
        stdin, stdout, stderr = c.exec_command(
            "ls -lh /work/ComfyUI/models/loras/minimax/HMNSFW_AIO_V2.safetensors "
            "/work/ComfyUI/models/loras/minimax/furry_lora_epoch31.safetensors"
        )
        print(stdout.read().decode("utf-8", "replace"), flush=True)
        print(stderr.read().decode("utf-8", "replace"), flush=True)
    finally:
        c.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
