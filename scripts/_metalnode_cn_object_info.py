#!/usr/bin/env python3
"""Query ComfyUI object_info for controlnet_aux preprocessors + JLC nodes."""
from pathlib import Path
import sys
import json
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "77.94.203.13"
PORT = 22024
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (4).txt")
USER = "root"

REMOTE = r'''
import json, urllib.request
try:
    data = json.loads(urllib.request.urlopen("http://127.0.0.1:8188/object_info", timeout=20).read())
    keys = list(data.keys())
    lk = [(k, k.lower()) for k in keys]
    interesting = [k for k, kl in lk if any(s in kl for s in ["pose", "depth", "jlc", "openpose", "canny", "dw"])]
    print("TOTAL NODES:", len(keys))
    print("MATCHES:")
    for k in sorted(interesting):
        print(" -", k)
except Exception as e:
    print("ERROR", e)
'''


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    client.connect(HOST, port=PORT, username=USER, pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)

    sftp = client.open_sftp()
    with sftp.file("/work/_oi_check.py", "w") as f:
        f.write(REMOTE)
    sftp.close()

    stdin, stdout, stderr = client.exec_command("python3 /work/_oi_check.py", timeout=40)
    print(stdout.read().decode(errors="replace"))
    err = stderr.read().decode(errors="replace")
    if err.strip():
        print("STDERR:", err)
    client.close()


if __name__ == "__main__":
    main()
