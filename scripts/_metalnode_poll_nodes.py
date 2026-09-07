#!/usr/bin/env python3
from pathlib import Path
import paramiko
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\metalnode_id_ed25519")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22024, username="root", pkey=pkey, timeout=60, allow_agent=False, look_for_keys=False)
_, so, _ = c.exec_command(
    "pgrep -af install_nodes_fix || echo done_proc; "
    "echo DONE_FILE; cat /work/INSTALL_NODES_FIX_DONE.txt 2>/dev/null || echo no; "
    "echo LOG_TAIL; tail -n 40 /work/INSTALL_NODES_FIX.log; "
    "echo NODES; ls /work/ComfyUI/custom_nodes",
    timeout=30,
)
Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\scripts\_poll_nodes_out.txt").write_text(
    so.read().decode("utf-8", errors="replace"), encoding="utf-8"
)
print("wrote poll file")
c.close()
