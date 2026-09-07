#!/usr/bin/env python3
"""Restart ComfyUI (kill tmux session, watchdog relaunches it) and verify."""
from pathlib import Path
import sys
import time
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "77.94.203.13"
PORT = 22024
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (4).txt")
USER = "root"


def run(client, cmd, timeout=40):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    return out, err


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    client.connect(HOST, port=PORT, username=USER, pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)

    print("Killing tmux session 'comfy' (watchdog should relaunch it)...")
    out, err = run(client, "tmux kill-session -t comfy 2>&1; echo done")
    print(out, err)

    print("Waiting for watchdog to relaunch (up to 60s)...")
    for i in range(12):
        time.sleep(5)
        out, err = run(client, "tmux ls 2>&1; curl -s -o /dev/null -w 'http=%{http_code}\\n' http://127.0.0.1:8188/system_stats 2>&1")
        print(f"[{(i+1)*5}s]", out.strip())
        if "http=200" in out:
            break

    print("--- final ps ---")
    out, err = run(client, "pgrep -af 'python main.py'")
    print(out)

    print("--- checking for import errors in latest comfy log ---")
    out, err = run(client, "tmux capture-pane -t comfy -p -S -300 2>&1 | grep -iE 'error|traceback|jlc' | tail -40")
    print(out or "(no error/JLC lines found)")

    client.close()


if __name__ == "__main__":
    main()
