#!/usr/bin/env python3
from pathlib import Path
import paramiko
import sys
time = __import__("time")

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (1).txt")
SCR = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\scripts\_metalnode_train_only_klein.sh")


def connect():
    for attempt in range(8):
        try:
            c = paramiko.SSHClient()
            c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
            c.connect(
                "77.94.203.13",
                port=22024,
                username="root",
                pkey=pkey,
                timeout=90,
                allow_agent=False,
                look_for_keys=False,
                banner_timeout=90,
            )
            print("connected", attempt, flush=True)
            return c
        except Exception as e:
            print("retry", attempt, e, flush=True)
            time.sleep(8)
    raise SystemExit("no ssh")


def run(c, cmd, timeout=60):
    _, so, se = c.exec_command(cmd, timeout=timeout)
    out = so.read().decode("utf-8", "replace")
    err = se.read().decode("utf-8", "replace")
    return out, err


c = connect()
data = SCR.read_bytes().replace(b"\r\n", b"\n").replace(b"\r", b"\n")
sftp = c.open_sftp()
with sftp.file("/tmp/train_only_klein.sh", "wb") as f:
    f.write(data)
sftp.close()
print("uploaded", len(data), flush=True)

# Kill without matching this SSH command line: use pgrep + kill by pid from short names
out, err = run(
    c,
    "pgrep -af 'continue_klein_te_train|run_klein_lora_train|/tmp/train_only' || true",
)
print("BEFORE:", out, flush=True)
# kill by exact script path only via pid list
out, err = run(
    c,
    r"""
for p in $(pgrep -f '/tmp/continue_klein_te_train.sh'); do kill $p 2>/dev/null; done
for p in $(pgrep -f '/tmp/run_klein_lora_train.sh'); do kill $p 2>/dev/null; done
for p in $(pgrep -f '/tmp/train_only_klein.sh'); do kill $p 2>/dev/null; done
for p in $(pgrep -f 'flux_2_train_network.py'); do kill $p 2>/dev/null; done
sleep 1
echo KILLED_OK
""",
)
print(out, err, flush=True)

# Start detached via setsid so SSH doesn't kill children; avoid pkill self-match
out, err = run(
    c,
    "setsid bash /tmp/train_only_klein.sh </dev/null >/work/TRAIN_ONLY.nohup 2>&1 & echo START_PID:$!",
    timeout=30,
)
print(out, err, flush=True)

time.sleep(40)
out, err = run(
    c,
    "pgrep -af 'train_only_klein|flux_2_train_network|accelerate' || true; echo ---; tail -60 /work/loras_out/olh_person_klein_train.log; echo ---; tail -30 /work/TRAIN_ONLY.nohup",
    timeout=60,
)
print(out, flush=True)
if err.strip():
    print("ERR", err[:1500], flush=True)
c.close()
