#!/usr/bin/env python3
"""Download patched All-in-One workflow from GPUGO to local Desktop."""
import os
from pathlib import Path

import paramiko

PASSWORD = os.environ.get("GPUGO_PASS") or "C5FdcIQ5"
DEST_DIR = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\workflows")
DEST = DEST_DIR / "Z-Image-ALLinONE-v2.json"
REMOTE = "/workspace/user/default/workflows/Z-Image-ALLinONE-v2.json"


def main():
    DEST_DIR.mkdir(parents=True, exist_ok=True)
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(
        "95.165.71.177",
        port=42010,
        username="root",
        password=PASSWORD,
        timeout=60,
        allow_agent=False,
        look_for_keys=False,
    )
    sftp = c.open_sftp()
    sftp.get(REMOTE, str(DEST))
    sftp.close()
    c.close()
    size = DEST.stat().st_size
    print(f"saved {DEST} ({size} bytes)")


if __name__ == "__main__":
    main()
