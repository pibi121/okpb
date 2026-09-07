#!/usr/bin/env python3
"""Download Z-Image assets on remote GPU host via SSH."""
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
        "/workspace/models/diffusion_models/z_image_turbo_bf16.safetensors",
        "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors",
    ),
    (
        "/workspace/models/text_encoders/qwen_3_4b.safetensors",
        "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors",
    ),
    (
        "/workspace/models/vae/ae.safetensors",
        "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors",
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


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 3600) -> int:
    print(f"$ {cmd}", flush=True)
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
        code = run(client, cmd, timeout=3600)
        if code != 0:
            raise SystemExit(f"download failed: {path}")
    finally:
        client.close()


def main() -> None:
    if not PASSWORD:
        raise SystemExit("GPUGO_PASS required")
    client = connect()
    try:
        run(
            client,
            "mkdir -p /workspace/models/diffusion_models /workspace/models/text_encoders /workspace/models/vae /workspace/logs",
            timeout=60,
        )
    finally:
        client.close()

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
            "ls -lh /workspace/models/diffusion_models/z_image_turbo_bf16.safetensors "
            "/workspace/models/text_encoders/qwen_3_4b.safetensors "
            "/workspace/models/vae/ae.safetensors",
            timeout=60,
        )
    finally:
        client.close()
    print("ALL OK", flush=True)


if __name__ == "__main__":
    main()
