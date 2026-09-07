#!/usr/bin/env python3
"""Upload olh_person dataset + bootstrap Ostris AI Toolkit on Metalnode for Klein LoRA."""
from __future__ import annotations

import sys
import time
from pathlib import Path

import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stdout.reconfigure(line_buffering=True)

KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (1).txt")
LOCAL_IMAGES = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\datasets\olh_person_zimage\images")
REMOTE_DS = "/work/datasets/olh_person_klein/images"
HOST = "77.94.203.13"
PORT = 22024


def connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c.connect(
        HOST,
        port=PORT,
        username="root",
        pkey=pkey,
        timeout=90,
        allow_agent=False,
        look_for_keys=False,
        banner_timeout=90,
    )
    return c


def run(c, cmd, timeout=600):
    _, so, se = c.exec_command(cmd, timeout=timeout)
    out = so.read().decode("utf-8", errors="replace")
    err = se.read().decode("utf-8", errors="replace")
    return out, err


def main():
    c = connect()
    print("connected", flush=True)
    out, _ = run(
        c,
        f"mkdir -p {REMOTE_DS} /work/train /work/loras_out /work/hf_cache; "
        "ls /work/train 2>/dev/null; echo OK",
    )
    print(out, flush=True)

    sftp = c.open_sftp()
    files = sorted(
        [
            p
            for p in LOCAL_IMAGES.iterdir()
            if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".txt", ".webp"}
        ]
    )
    print(f"uploading {len(files)} files...", flush=True)
    for i, p in enumerate(files, 1):
        remote = f"{REMOTE_DS}/{p.name}"
        sftp.put(str(p), remote)
        if i % 10 == 0 or i == len(files):
            print(f"  {i}/{len(files)} {p.name}", flush=True)
    sftp.close()

    out, _ = run(
        c,
        f"ls {REMOTE_DS}/*.png | wc -l; ls {REMOTE_DS}/*.txt | wc -l; "
        f"head -1 {REMOTE_DS}/olh_001.txt; du -sh {REMOTE_DS}",
    )
    print(out, flush=True)

    # clone ai-toolkit
    print("cloning ai-toolkit...", flush=True)
    out, err = run(
        c,
        r"""
set -e
export PATH=/usr/bin:/bin:/usr/local/bin
cd /work/train
if [ ! -d ai-toolkit/.git ]; then
  rm -rf ai-toolkit
  GIT_TERMINAL_PROMPT=0 git -c credential.helper= clone --depth 1 https://github.com/ostris/ai-toolkit.git ai-toolkit
fi
cd ai-toolkit
git rev-parse --short HEAD
ls config/examples 2>/dev/null | grep -i klein || ls config/examples | head -40
echo CLONE_OK
""",
        timeout=300,
    )
    print(out[-3000:], flush=True)
    if err:
        print("err", err[-1000:], flush=True)

    c.close()
    print("BOOTSTRAP_UPLOAD_OK", flush=True)


if __name__ == "__main__":
    main()
