#!/usr/bin/env python3
import os
import time
from pathlib import Path

import paramiko

PASSWORD = os.environ.get("GPUGO_PASS") or "C5FdcIQ5"
HELPER = Path(__file__).with_name("_gpugo_download_wan_i2v.py")


def connect():
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
    return c


def main():
    # Re-extract REMOTE_HELPER by running the download module's embedded content:
    # simpler: upload a clean remote script from this file's sibling content
    import importlib.util
    # read REMOTE_HELPER string from _gpugo_download_wan_i2v.py by exec? just re-upload via running that file's logic
    from _gpugo_download_wan_i2v import REMOTE_HELPER  # type: ignore

    c = connect()
    sftp = c.open_sftp()
    with sftp.file("/tmp/wan_i2v_download.py", "w") as f:
        f.write(REMOTE_HELPER)
    sftp.close()

    _, stdout, stderr = c.exec_command(
        "chmod +x /tmp/wan_i2v_download.py; "
        "pkill -f '/tmp/wan_i2v_download.py' >/dev/null 2>&1 || true; sleep 1; "
        "nohup /opt/ComfyUI/.venv/bin/python -u /tmp/wan_i2v_download.py "
        ">> /workspace/WAN_I2V_DOWNLOAD.nohup 2>&1 & echo $!; sleep 3; "
        "ps aux | grep wan_i2v_download | grep -v grep; "
        "tail -n 20 /workspace/WAN_I2V_DOWNLOAD.log 2>/dev/null || tail -n 20 /workspace/WAN_I2V_DOWNLOAD.nohup",
        timeout=60,
    )
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    Path(__file__).with_name("_wan_dl_out.txt").write_text(out + "\n" + err, encoding="utf-8")
    print(out.encode("ascii", "replace").decode("ascii"))
    c.close()


if __name__ == "__main__":
    # ensure import path
    import sys
    sys.path.insert(0, str(Path(__file__).parent))
    main()
