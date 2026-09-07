#!/usr/bin/env python3
"""Download UltraReal + Flux CLIP/T5 on remote GPU."""
from __future__ import annotations

import os
import sys
import threading
import time

import paramiko

HOST = os.environ.get("GPUGO_HOST", "95.165.71.177")
PORT = int(os.environ.get("GPUGO_PORT", "42010"))
USER = os.environ.get("GPUGO_USER", "root")
PASSWORD = os.environ.get("GPUGO_PASS", "")

FILES = [
    (
        "/workspace/models/diffusion_models/ultrarealFineTune_v4.safetensors",
        "https://huggingface.co/Mixard/NewFlux/resolve/main/ultrarealFineTune_v4.safetensors",
    ),
    (
        "/workspace/models/text_encoders/clip_l.safetensors",
        "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors",
    ),
    (
        "/workspace/models/text_encoders/t5xxl_fp16.safetensors",
        "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp16.safetensors",
    ),
]


def connect() -> paramiko.SSHClient:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
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


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 7200) -> int:
    print(f"$ {cmd[:180]}...", flush=True) if len(cmd) > 180 else print(f"$ {cmd}", flush=True)
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout, get_pty=True)
    while not stdout.channel.exit_status_ready():
        if stdout.channel.recv_ready():
            sys.stdout.write(stdout.channel.recv(8192).decode(errors="replace"))
            sys.stdout.flush()
        time.sleep(0.1)
    while stdout.channel.recv_ready():
        sys.stdout.write(stdout.channel.recv(8192).decode(errors="replace"))
    code = stdout.channel.recv_exit_status()
    print(f"[exit {code}]", flush=True)
    return code


def download_one(path: str, url: str) -> None:
    client = connect()
    try:
        cmd = (
            f'mkdir -p "$(dirname "{path}")" && '
            f'wget -c --progress=dot:giga -O "{path}" "{url}" && '
            f'ls -lh "{path}"'
        )
        code = run(client, cmd, timeout=7200)
        if code != 0:
            raise SystemExit(f"download failed: {path}")
    finally:
        client.close()


def main() -> None:
    if not PASSWORD:
        raise SystemExit("GPUGO_PASS required")
    threads = [
        threading.Thread(target=download_one, args=(path, url), name=path)
        for path, url in FILES
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    client = connect()
    try:
        run(
            client,
            "ls -lh /workspace/models/diffusion_models/ultrarealFineTune_v4.safetensors "
            "/workspace/models/text_encoders/clip_l.safetensors "
            "/workspace/models/text_encoders/t5xxl_fp16.safetensors "
            "/workspace/models/vae/ae.safetensors",
        )
    finally:
        client.close()
    print("ALL OK", flush=True)


if __name__ == "__main__":
    main()
