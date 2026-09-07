#!/usr/bin/env python3
"""Upload olh_person_zimage dataset images+txt to GPUGO via SFTP."""
import os
from pathlib import Path

import paramiko

PASSWORD = os.environ.get("GPUGO_PASS") or "C5FdcIQ5"
LOCAL = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\datasets\olh_person_zimage\images")
REMOTE = "/workspace/datasets/olh_person_zimage/images"


def main():
    files = sorted(LOCAL.glob("olh_*.png")) + sorted(LOCAL.glob("olh_*.txt"))
    print("local files", len(files))
    assert len(list(LOCAL.glob("olh_*.png"))) == 25
    assert len(list(LOCAL.glob("olh_*.txt"))) == 25

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
    # ensure remote dir
    _, stdout, _ = c.exec_command(f"mkdir -p {REMOTE} && rm -f {REMOTE}/olh_*")
    stdout.channel.recv_exit_status()

    sftp = c.open_sftp()
    for i, f in enumerate(files, 1):
        remote = f"{REMOTE}/{f.name}"
        sftp.put(str(f), remote)
        if i % 10 == 0 or f.suffix == ".png" and i <= 3:
            print(f"uploaded {i}/{len(files)} {f.name}", flush=True)
    sftp.close()

    _, stdout, _ = c.exec_command(
        f"ls {REMOTE} | wc -l; ls -lh {REMOTE} | head; du -sh {REMOTE}"
    )
    print(stdout.read().decode())
    c.close()
    print("UPLOAD_OK")


if __name__ == "__main__":
    main()
