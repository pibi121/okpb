#!/usr/bin/env python3
"""Get FaceDetailer + bbox loader node specs from Impact-Pack."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HOST = "77.94.203.13"
PORT = 22024
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (4).txt")
USER = "root"

NODES = ["FaceDetailer", "UltralyticsDetectorProvider", "SAMLoader"]

REMOTE = r'''
import json, urllib.request
data = json.loads(urllib.request.urlopen("http://127.0.0.1:8188/object_info", timeout=20).read())
names = %s
for n in names:
    if n not in data:
        print(f"=== {n} === MISSING")
        continue
    info = data[n]
    print(f"=== {n} ===")
    print("inputs:", json.dumps(info.get("input", {}))[:2500])
    print("outputs:", info.get("output"), info.get("output_name"))
    print()
''' % repr(NODES)


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    client.connect(HOST, port=PORT, username=USER, pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
    sftp = client.open_sftp()
    with sftp.file("/work/_fd_specs.py", "w") as f:
        f.write(REMOTE)
    sftp.close()
    stdin, stdout, stderr = client.exec_command("python3 /work/_fd_specs.py", timeout=30)
    print(stdout.read().decode(errors="replace"))
    err = stderr.read().decode(errors="replace")
    if err.strip():
        print("STDERR:", err)
    client.close()


if __name__ == "__main__":
    main()
