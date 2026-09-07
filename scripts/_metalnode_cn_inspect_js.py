#!/usr/bin/env python3
"""Inspect JLC orchestrator python node source (INPUT_TYPES + RETURN order) and web/ JS for widget/slot behavior."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "77.94.203.13"
PORT = 22024
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (4).txt")
USER = "root"

CMD = (
    "echo '--- web dir ---'; find /work/ComfyUI/custom_nodes/JLC-Flux2-ControlNet/web -type f | head -30; "
    "echo '--- orchestrator node py (first 150 lines) ---'; "
    "sed -n '1,150p' /work/ComfyUI/custom_nodes/JLC-Flux2-ControlNet/nodes/jlc_flux2_controlnet_orchestrator_node.py"
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
