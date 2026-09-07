#!/usr/bin/env python3
"""Resume UltraReal download via nohup on remote, then poll until complete."""
from __future__ import annotations

import os
import time

import paramiko

HOST = os.environ.get("GPUGO_HOST", "95.165.71.177")
PORT = int(os.environ.get("GPUGO_PORT", "42010"))
USER = os.environ.get("GPUGO_USER", "root")
PASSWORD = os.environ["GPUGO_PASS"]
TARGET = "/workspace/models/diffusion_models/ultrarealFineTune_v4.safetensors"
URL = "https://huggingface.co/Mixard/NewFlux/resolve/main/ultrarealFineTune_v4.safetensors"
EXPECTED = 23802910592  # bytes from HF


def connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    for attempt in range(5):
        try:
            c.connect(
                HOST,
                port=PORT,
                username=USER,
                password=PASSWORD,
                timeout=45,
                allow_agent=False,
                look_for_keys=False,
            )
            return c
        except Exception as e:
            print(f"connect fail {attempt}: {e}")
            time.sleep(3)
    raise SystemExit("cannot connect")


def run(cmd: str, timeout: int = 120) -> str:
    client = connect()
    try:
        stdin, stdout, stderr = client.exec_command(cmd, get_pty=True, timeout=timeout)
        out = stdout.read().decode(errors="replace")
        print(out)
        return out
    finally:
        client.close()


def file_size() -> int:
    out = run(f'stat -c%s "{TARGET}" 2>/dev/null || echo 0')
    for line in out.strip().splitlines():
        line = line.strip()
        if line.isdigit():
            return int(line)
    return 0


def main() -> None:
    run(
        f"""
mkdir -p /workspace/logs /workspace/models/diffusion_models
# kill stale wget for this file if any
pkill -f 'ultrarealFineTune_v4.safetensors' || true
sleep 1
nohup wget -c --progress=dot:giga -O "{TARGET}" "{URL}" > /workspace/logs/dl_ultrareal.log 2>&1 &
echo STARTED
sleep 2
ps aux | grep ultrareal | grep -v grep | head
"""
    )
    while True:
        size = file_size()
        pct = 100.0 * size / EXPECTED if EXPECTED else 0
        print(f"size={size} ({pct:.1f}%) expect={EXPECTED}", flush=True)
        if size >= EXPECTED:
            print("COMPLETE", flush=True)
            break
        # check wget still running
        out = run("ps aux | grep 'ultrarealFineTune_v4' | grep wget | grep -v grep | head -2")
        if "wget" not in out and size < EXPECTED:
            print("wget died, restarting...", flush=True)
            run(
                f'nohup wget -c --progress=dot:giga -O "{TARGET}" "{URL}" >> /workspace/logs/dl_ultrareal.log 2>&1 &'
            )
        time.sleep(30)
    run(f"ls -lh {TARGET}; curl -s http://127.0.0.1:9000/models/diffusion_models; echo")


if __name__ == "__main__":
    main()
