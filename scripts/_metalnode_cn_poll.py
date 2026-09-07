#!/usr/bin/env python3
"""Poll FLUX.2-dev-Fun-Controlnet-Union download progress."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "77.94.203.13"
PORT = 22024
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (4).txt")
USER = "root"

CMD = (
    "ls -lh /work/ComfyUI/models/controlnet/FLUX.2-dev-Fun-Controlnet-Union.safetensors 2>/dev/null; "
    "pgrep -af curl; "
    "tail -c 400 /work/CN_DOWNLOAD.log | tr '\\r' '\\n' | tail -5"
)


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    client.connect(HOST, port=PORT, username=USER, pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
    stdin, stdout, stderr = client.exec_command(CMD, timeout=30)
    print(stdout.read().decode(errors="replace"))
    err = stderr.read().decode(errors="replace")
    if err.strip():
        print("STDERR:", err)
    client.close()


if __name__ == "__main__":
    main()
