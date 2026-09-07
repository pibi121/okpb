#!/usr/bin/env python3
"""Fetch full history/error detail for last ControlNet test prompt."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "77.94.203.13"
PORT = 22024
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (4).txt")
USER = "root"
PROMPT_ID = "9ec4ea46-a26f-4f44-b5a1-51b3d08deb60"

REMOTE = f'''
import json, urllib.request
h = json.loads(urllib.request.urlopen("http://127.0.0.1:8188/history/{PROMPT_ID}", timeout=20).read())
entry = h.get("{PROMPT_ID}", {{}})
status = entry.get("status", {{}})
print(json.dumps(status, indent=2)[:6000])
'''


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    client.connect(HOST, port=PORT, username=USER, pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
    sftp = client.open_sftp()
    with sftp.file("/work/_cn_get_error.py", "w") as f:
        f.write(REMOTE)
    sftp.close()
    stdin, stdout, stderr = client.exec_command("python3 /work/_cn_get_error.py", timeout=30)
    print(stdout.read().decode(errors="replace"))
    err = stderr.read().decode(errors="replace")
    if err.strip():
        print("STDERR:", err)
    client.close()


if __name__ == "__main__":
    main()
