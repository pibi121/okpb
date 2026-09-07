#!/usr/bin/env python3
from pathlib import Path
import paramiko
import json
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (2).txt")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=40, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()
sftp.get(
    "/work/ComfyUI/custom_nodes/ComfyUI-MMAudio/example_workflows/mmaudio_test.json",
    str(Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\workflows\mmaudio_test.json")),
)
sftp.close()
c.close()
# summarize nodes
data = json.loads(Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\workflows\mmaudio_test.json").read_text(encoding="utf-8"))
nodes = data.get("nodes") or data
if isinstance(nodes, dict) and "nodes" in nodes:
    nodes = nodes["nodes"]
for n in nodes:
    print(n.get("type"), n.get("title"), (n.get("widgets_values") or [])[:4])
