#!/usr/bin/env python3
"""Kick Remix download (upload + nohup)."""
from __future__ import annotations

import os
import time

import paramiko

PASSWORD = os.environ.get("GPUGO_PASS") or "C5FdcIQ5"

# Import REMOTE body from installer by re-defining briefly — read sibling file
from pathlib import Path

src = Path(__file__).with_name("_gpugo_install_remix.py").read_text(encoding="utf-8")
start = src.index("REMOTE = r'''") + len("REMOTE = r'''")
end = src.index("'''", start)
SCRIPT = src[start:end]


def connect(retries=20):
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    last = None
    for i in range(retries):
        try:
            c.connect(
                "95.165.71.177",
                port=42010,
                username="root",
                password=PASSWORD,
                timeout=90,
                allow_agent=False,
                look_for_keys=False,
                banner_timeout=90,
            )
            t = c.get_transport()
            if t:
                t.set_keepalive(20)
            return c
        except Exception as e:
            last = e
            print("retry", i, e, flush=True)
            time.sleep(5)
    raise SystemExit(f"ssh fail: {last}")


def main():
    c = connect()
    sftp = c.open_sftp()
    with sftp.file("/tmp/install_remix.py", "w") as f:
        f.write(SCRIPT)
    sftp.close()
    print("uploaded", len(SCRIPT), flush=True)
    c.close()

    time.sleep(1)
    c = connect()
    cmd = (
        "pkill -f /tmp/install_remix.py >/dev/null 2>&1 || true; "
        "nohup /opt/ComfyUI/.venv/bin/python -u /tmp/install_remix.py "
        "> /workspace/REMIX_DOWNLOAD.nohup 2>&1 & "
        "echo PID=$!; sleep 5; "
        "pgrep -af install_remix || echo NO_PROC; "
        "echo ---LOG---; "
        "head -n 25 /workspace/REMIX_DOWNLOAD.log || true; "
        "echo ---NOHUP---; "
        "head -n 25 /workspace/REMIX_DOWNLOAD.nohup || true"
    )
    _, so, se = c.exec_command(cmd, timeout=90)
    print(so.read().decode("utf-8", errors="replace"))
    err = se.read().decode("utf-8", errors="replace")
    if err.strip():
        print("STDERR:", err[-800:])
    c.close()


if __name__ == "__main__":
    main()
