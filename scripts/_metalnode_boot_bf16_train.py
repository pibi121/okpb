#!/usr/bin/env python3
from pathlib import Path
import paramiko
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (1).txt")
SCRIPTS = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\scripts")


def connect():
    for attempt in range(8):
        try:
            c = paramiko.SSHClient()
            c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
            c.connect(
                "77.94.203.13", port=22024, username="root", pkey=pkey, timeout=90,
                allow_agent=False, look_for_keys=False, banner_timeout=90,
            )
            print("connected", attempt, flush=True)
            return c
        except Exception as e:
            print("retry", attempt, e, flush=True)
            time.sleep(8)
    raise SystemExit("no ssh")


def put_lf(sftp, name, remote):
    data = (SCRIPTS / name).read_bytes().replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    with sftp.file(remote, "wb") as f:
        f.write(data)
    print("uploaded", name, len(data), flush=True)


def run(c, cmd, timeout=60):
    _, so, se = c.exec_command(cmd, timeout=timeout)
    return so.read().decode("utf-8", "replace"), se.read().decode("utf-8", "replace")


c = connect()
sftp = c.open_sftp()
put_lf(sftp, "_metalnode_dequant_dit_bf16.sh", "/tmp/dequant_dit_bf16.sh")
put_lf(sftp, "_metalnode_train_bf16_klein.sh", "/tmp/train_bf16_klein.sh")
sftp.close()

# kill old trains carefully
out, _ = run(c, r"""
chmod +x /tmp/dequant_dit_bf16.sh /tmp/train_bf16_klein.sh
for p in $(pgrep -f '/tmp/train_only_klein.sh'); do kill $p 2>/dev/null; done
for p in $(pgrep -f 'flux_2_train_network.py'); do kill $p 2>/dev/null; done
sleep 1
echo READY
""")
print(out, flush=True)

out, err = run(c, "setsid bash /tmp/dequant_dit_bf16.sh </dev/null >/work/DEQUANT.nohup 2>&1 & echo DEQ_PID:$!", 30)
print(out, err, flush=True)
out, err = run(c, "setsid bash /tmp/train_bf16_klein.sh </dev/null >/work/TRAIN_BF16.nohup 2>&1 & echo TRAIN_PID:$!", 30)
print(out, err, flush=True)

time.sleep(45)
out, err = run(c, r"""
pgrep -af 'dequant_dit|train_bf16|flux_2_train' || true
echo ---LOG---
tail -40 /work/loras_out/olh_person_klein_train.log
echo ---DEQ---
tail -30 /work/DEQUANT.nohup
""", 60)
print(out, flush=True)
c.close()
