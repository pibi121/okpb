#!/usr/bin/env python3
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (6).txt")

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22024, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
stdin, stdout, stderr = c.exec_command(
    "tail -60 /work/LLM_CREATE.log; echo '---'; ollama list 2>/dev/null; echo '---'; nvidia-smi --query-gpu=memory.used,memory.free --format=csv,noheader; echo '---'; ps aux | grep -E 'ollama|create_ollama' | grep -v grep",
    timeout=30,
)
print(stdout.read().decode(errors="replace"))
c.close()
