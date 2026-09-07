#!/usr/bin/env python3
"""Temporary SSH helper for GPUGO setup. Do not commit passwords."""
from __future__ import annotations

import argparse
import os
import sys
import time

import paramiko

HOST = os.environ.get("GPUGO_HOST", "95.165.71.177")
PORT = int(os.environ.get("GPUGO_PORT", "42010"))
USER = os.environ.get("GPUGO_USER", "root")
PASSWORD = os.environ.get("GPUGO_PASS", "")


def connect() -> paramiko.SSHClient:
    if not PASSWORD:
        raise SystemExit("Set GPUGO_PASS env var")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        HOST,
        port=PORT,
        username=USER,
        password=PASSWORD,
        timeout=45,
        allow_agent=False,
        look_for_keys=False,
    )
    return client


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 600) -> tuple[int, str, str]:
    print(f"\n$ {cmd}", flush=True)
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout, get_pty=True)
    out_chunks: list[str] = []
    err_chunks: list[str] = []
    while not stdout.channel.exit_status_ready():
        if stdout.channel.recv_ready():
            chunk = stdout.channel.recv(4096).decode(errors="replace")
            out_chunks.append(chunk)
            print(chunk, end="", flush=True)
        if stderr.channel.recv_stderr_ready():
            chunk = stderr.channel.recv_stderr(4096).decode(errors="replace")
            err_chunks.append(chunk)
            print(chunk, end="", file=sys.stderr, flush=True)
        time.sleep(0.05)
    # drain
    while stdout.channel.recv_ready():
        chunk = stdout.channel.recv(4096).decode(errors="replace")
        out_chunks.append(chunk)
        print(chunk, end="", flush=True)
    while stderr.channel.recv_stderr_ready():
        chunk = stderr.channel.recv_stderr(4096).decode(errors="replace")
        err_chunks.append(chunk)
        print(chunk, end="", file=sys.stderr, flush=True)
    code = stdout.channel.recv_exit_status()
    print(f"\n[exit {code}]", flush=True)
    return code, "".join(out_chunks), "".join(err_chunks)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("cmd", nargs="+", help="remote command")
    parser.add_argument("--timeout", type=int, default=600)
    args = parser.parse_args()
    cmd = " ".join(args.cmd)
    client = connect()
    try:
        code, _, _ = run(client, cmd, timeout=args.timeout)
        sys.exit(code)
    finally:
        client.close()


if __name__ == "__main__":
    main()
