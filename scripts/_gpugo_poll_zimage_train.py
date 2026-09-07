#!/usr/bin/env python3
import os
from pathlib import Path

import paramiko

PASSWORD = os.environ.get("GPUGO_PASS") or "C5FdcIQ5"
OUT = Path(__file__).with_name("_train_log_tail.txt")

REMOTE = r"""
python3 << 'PY'
import pathlib, subprocess
p = pathlib.Path('/workspace/loras_out/olh_person_zimage_train.pid')
pid = p.read_text().strip() if p.exists() else ''
print('PID', pid)
if pid:
    r = subprocess.run(['ps', '-p', pid, '-o', 'pid,etime,cmd'], capture_output=True, text=True)
    print(r.stdout if r.returncode == 0 else 'DEAD')
else:
    print('NO_PID')
logp = pathlib.Path('/workspace/loras_out/olh_person_zimage_train.log')
log = logp.read_text(errors='replace') if logp.exists() else ''
print('LOG_BYTES', len(log))
# strip non-ascii progress junk for console
tail = log[-8000:]
pathlib.Path('/tmp/train_tail.txt').write_text(tail, encoding='utf-8')
# also list outputs
import os
out = '/workspace/loras_out'
for root, dirs, files in os.walk(out):
    for f in files:
        if f.endswith(('.safetensors', '.log', '.pid', '.json', '.txt', '.png', '.jpg')):
            fp = os.path.join(root, f)
            print('FILE', fp, os.path.getsize(fp))
PY
"""


def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(
        "95.165.71.177",
        port=42010,
        username="root",
        password=PASSWORD,
        timeout=60,
        allow_agent=False,
        look_for_keys=False,
    )
    _, stdout, stderr = c.exec_command(REMOTE, timeout=60)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    sftp = c.open_sftp()
    try:
        sftp.get("/tmp/train_tail.txt", str(OUT))
    except Exception as e:
        OUT.write_text(out + "\n" + err, encoding="utf-8")
        print("no remote tail", e)
    sftp.close()
    c.close()
    # ascii-safe print
    print(out.encode("ascii", "replace").decode("ascii"))
    print("--- tail file ---")
    print(OUT.read_text(encoding="utf-8", errors="replace")[-3500:].encode("ascii", "replace").decode("ascii"))


if __name__ == "__main__":
    main()
