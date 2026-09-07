#!/usr/bin/env python3
"""Install JLC-Flux2-ControlNet node + kick off FLUX.2-dev-Fun-Controlnet-Union download."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "77.94.203.13"
PORT = 22024
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (4).txt")
USER = "root"

REMOTE_SCRIPT = r'''#!/usr/bin/env python3
import subprocess, os, sys
from pathlib import Path

CN_DIR = Path("/work/ComfyUI/custom_nodes/JLC-Flux2-ControlNet")
MODELS = Path("/work/ComfyUI/models/controlnet")
LOG = Path("/work/CN_DOWNLOAD.log")
STATUS = Path("/work/CN_STATUS.txt")

def run(cmd, **kw):
    print("+", cmd)
    return subprocess.run(cmd, shell=True, **kw)

STATUS.write_text("INSTALLING_NODE\n")

if not CN_DIR.exists():
    r = run(f"cd /work/ComfyUI/custom_nodes && git clone https://github.com/Damkohler/JLC-Flux2-ControlNet.git", capture_output=True, text=True)
    print(r.stdout[-3000:], r.stderr[-3000:])
else:
    print("JLC-Flux2-ControlNet already cloned, pulling latest")
    r = run(f"cd {CN_DIR} && git pull", capture_output=True, text=True)
    print(r.stdout[-2000:], r.stderr[-2000:])

# check for extra pip deps declared in pyproject.toml (best-effort, non-fatal)
pyproj = CN_DIR / "pyproject.toml"
if pyproj.exists():
    print("--- pyproject.toml ---")
    print(pyproj.read_text(encoding="utf-8", errors="replace")[:2000])

MODELS.mkdir(parents=True, exist_ok=True)
target = MODELS / "FLUX.2-dev-Fun-Controlnet-Union.safetensors"
url = "https://huggingface.co/alibaba-pai/FLUX.2-dev-Fun-Controlnet-Union/resolve/main/FLUX.2-dev-Fun-Controlnet-Union.safetensors"

STATUS.write_text("DOWNLOADING_MODEL\n")

nohup_cmd = (
    f'nohup curl -4 -L --retry 10 --retry-delay 5 -C - '
    f'-o "{target}" "{url}" '
    f'>> {LOG} 2>&1 &'
)
# launch detached background download via bash -c with disown so it survives SSH disconnect
run(f'bash -c \'{nohup_cmd}\'')

import time
time.sleep(5)
r = run(f'pgrep -af curl', capture_output=True, text=True)
print("curl procs:\n", r.stdout)
print("Download launched in background. Check /work/CN_DOWNLOAD.log and file size at", target)
'''


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    client.connect(HOST, port=PORT, username=USER, pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)

    sftp = client.open_sftp()
    remote_path = "/work/_cn_install.py"
    with sftp.file(remote_path, "w") as f:
        f.write(REMOTE_SCRIPT)
    sftp.close()

    stdin, stdout, stderr = client.exec_command(f"python3 {remote_path}", timeout=60)
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    print(out)
    if err.strip():
        print("STDERR:", err)

    client.close()


if __name__ == "__main__":
    main()
