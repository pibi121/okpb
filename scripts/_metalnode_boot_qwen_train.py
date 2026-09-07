#!/usr/bin/env python3
"""Upload & start Qwen curl DL + continue TE/train waiter on Metalnode (LF line endings)."""
from pathlib import Path
import paramiko
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (1).txt")
SCRIPTS = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\scripts")
HOST, PORT = "77.94.203.13", 22024


def put_lf(sftp, local: Path, remote: str):
    data = local.read_bytes().replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    with sftp.file(remote, "wb") as f:
        f.write(data)
    print(f"uploaded {local.name} -> {remote} ({len(data)} bytes)", flush=True)


def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c.connect(
        HOST, port=PORT, username="root", pkey=pkey, timeout=90,
        allow_agent=False, look_for_keys=False, banner_timeout=90,
    )
    sftp = c.open_sftp()
    put_lf(sftp, SCRIPTS / "_metalnode_dl_qwen3_curl.sh", "/tmp/dl_qwen3_curl.sh")
    put_lf(sftp, SCRIPTS / "_metalnode_continue_klein_te_train.sh", "/tmp/continue_klein_te_train.sh")
    sftp.close()

    # Stepwise: kill, start DL, start waiter
    steps = [
        ("chmod +x /tmp/dl_qwen3_curl.sh /tmp/continue_klein_te_train.sh; ls -la /tmp/dl_qwen3_curl.sh /tmp/continue_klein_te_train.sh", 30),
        ("pkill -f '/tmp/dl_qwen3_curl.sh' || true; pkill -f '/tmp/continue_klein_te_train.sh' || true; pkill -f 'dl_qwen3_8b.sh' || true; sleep 1; echo KILLED", 30),
        ("nohup bash /tmp/dl_qwen3_curl.sh > /work/QWEN_CURL.nohup 2>&1 & echo DL_PID:$!", 30),
        ("nohup bash /tmp/continue_klein_te_train.sh > /work/CONTINUE_TE.nohup 2>&1 & echo WAIT_PID:$!", 30),
    ]
    for cmd, to in steps:
        _, so, se = c.exec_command(cmd, timeout=to)
        print(so.read().decode("utf-8", "replace"), end="", flush=True)
        err = se.read().decode("utf-8", "replace")
        if err.strip():
            print("ERR:", err[:500], flush=True)

    time.sleep(25)
    _, so, se = c.exec_command(
        "ps aux | grep -E 'dl_qwen3_curl|continue_klein|curl -4' | grep -v grep; "
        "echo '---LOG---'; tail -20 /work/loras_out/olh_person_klein_train.log; "
        "echo '---CURL---'; head -40 /work/QWEN_CURL.nohup; "
        "echo '---CONT---'; head -20 /work/CONTINUE_TE.nohup",
        timeout=60,
    )
    print(so.read().decode("utf-8", "replace"), flush=True)
    c.close()


if __name__ == "__main__":
    main()
