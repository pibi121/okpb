#!/usr/bin/env python3
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (6).txt")

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22024, username="root", pkey=pkey, timeout=60, banner_timeout=60, allow_agent=False, look_for_keys=False)
stdin, stdout, stderr = c.exec_command(
    "grep -E '=====|tokens=|SMOKE_OK|READY|END|Error|Traceback|success' /work/LLM_SMOKE.log | head -80; echo '==== FULL TAIL ===='; tail -100 /work/LLM_SMOKE.log",
    timeout=30,
)
print(stdout.read().decode(errors="replace"))
c.close()
