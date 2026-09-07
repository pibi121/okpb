#!/usr/bin/env python3
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HOST = "77.94.203.13"
PORT = 22024
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (4).txt")
USER = "root"

REMOTE = r'''
import json, urllib.request
data = json.loads(urllib.request.urlopen("http://127.0.0.1:8188/object_info/FaceDetailer", timeout=20).read())
info = data["FaceDetailer"]
req = info.get("input", {}).get("required", {})
for k in ["sam_threshold", "sam_bbox_expansion", "sam_mask_hint_threshold", "sam_mask_hint_use_negative", "drop_size", "wildcard", "cycle"]:
    print(k, "=", req.get(k))
'''


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    client.connect(HOST, port=PORT, username=USER, pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
    sftp = client.open_sftp()
    with sftp.file("/work/_fd_full2.py", "w") as f:
        f.write(REMOTE)
    sftp.close()
    stdin, stdout, stderr = client.exec_command("python3 /work/_fd_full2.py", timeout=30)
    print(stdout.read().decode(errors="replace"))
    err = stderr.read().decode(errors="replace")
    if err.strip():
        print("STDERR:", err)
    client.close()


if __name__ == "__main__":
    main()
