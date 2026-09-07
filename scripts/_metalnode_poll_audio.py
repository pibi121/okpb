#!/usr/bin/env python3
from pathlib import Path
import paramiko
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (2).txt")

def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=40, allow_agent=False, look_for_keys=False)
    for i in range(60):
        _, so, _ = c.exec_command(
            "echo ===; tail -20 /work/AUDIO_STACK.log 2>/dev/null; echo ---STATUS---; "
            "cat /work/AUDIO_STACK_STATUS.txt 2>/dev/null; echo ---FILES---; "
            "ls -lh /work/ComfyUI/models/mmaudio/ 2>/dev/null; "
            "ls /work/ComfyUI/custom_nodes | grep -iE 'mmaudio|muse'; "
            "pgrep -af install_audio_stack | grep -v grep || echo NO_INSTALLER; "
            "curl -s -o /dev/null -w 'comfy=%{http_code}\\n' http://127.0.0.1:8188/",
            timeout=30,
        )
        out = so.read().decode()
        print(f"\n--- poll {i} ---")
        print(out[-2500:])
        if "ALL_DONE" in out or ("NO_INSTALLER" in out and ("PARTIAL" in out or "ALL_DONE" in out)):
            break
        if "NO_INSTALLER" in out and i > 3 and "START" in out and "DL" not in out and "OK" in out:
            # finished maybe without ALL_DONE
            if "FINISHED" in out or "DONE status" in out:
                break
        time.sleep(25)
    # extra: musetalk hints + sample
    _, so, _ = c.exec_command(
        "ls -lh /work/ComfyUI/input/test_dialogue* 2>/dev/null; "
        "head -80 /work/MUSETALK_PATH_HINTS.txt 2>/dev/null; "
        "grep -iE 'Error|Traceback|MMAudio|MuseTalk|Import' /work/comfy_restart.log | tail -30",
        timeout=30,
    )
    print("===EXTRA===")
    print(so.read().decode())
    c.close()

if __name__ == "__main__":
    main()
