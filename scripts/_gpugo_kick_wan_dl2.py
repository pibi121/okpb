#!/usr/bin/env python3
"""Upload and start Wan download using only Python remote (no bash $)."""
import os
import sys
import time
from pathlib import Path

import paramiko

sys.path.insert(0, str(Path(__file__).parent))
from _gpugo_download_wan_i2v import REMOTE_HELPER  # noqa: E402

PASSWORD = os.environ.get("GPUGO_PASS") or "C5FdcIQ5"


def main():
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
    with sftp.file("/tmp/wan_i2v_download.py", "w") as f:
        f.write(REMOTE_HELPER)
    sftp.close()

    # start detached
    transport = c.get_transport()
    channel = transport.open_session()
    channel.exec_command(
        "setsid /opt/ComfyUI/.venv/bin/python -u /tmp/wan_i2v_download.py "
        "> /workspace/WAN_I2V_DOWNLOAD.nohup 2>&1 < /dev/null"
    )
    time.sleep(2)
    channel.close()

    _, stdout, stderr = c.exec_command(
        "python3 - <<'PY'\n"
        "import time, pathlib, subprocess\n"
        "time.sleep(5)\n"
        "r=subprocess.run(['pgrep','-af','wan_i2v_download'],capture_output=True,text=True)\n"
        "print('PROCS', r.stdout or 'none')\n"
        "for p in ['/workspace/WAN_I2V_DOWNLOAD.log','/workspace/WAN_I2V_DOWNLOAD.nohup']:\n"
        "  path=pathlib.Path(p)\n"
        "  if path.exists():\n"
        "    print('FILE', p, path.stat().st_size)\n"
        "    print(path.read_text(errors='replace')[-1500:])\n"
        "PY",
        timeout=60,
    )
    text = stdout.read().decode("utf-8", errors="replace")
    Path(__file__).with_name("_wan_dl_out.txt").write_text(text, encoding="utf-8")
    print(text.encode("ascii", "replace").decode("ascii"))
    c.close()


if __name__ == "__main__":
    main()
