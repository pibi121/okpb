#!/usr/bin/env python3
from pathlib import Path
import paramiko, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (1).txt")
c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22024, username="root", pkey=pkey, timeout=90, allow_agent=False, look_for_keys=False, banner_timeout=90)
sftp = c.open_sftp()
with sftp.file("/tmp/train_err.sh", "w") as f:
    f.write(r"""
grep -n 'TRAIN_START\|TRAIN_FAIL\|TRAIN_DONE\|Error\|Traceback\|ModuleNotFound\|FileNotFound\|CUDA\|OOM\|ValueError\|TypeError\|RuntimeError\|ALL_DONE\|CACHE_TE_OK' /work/loras_out/olh_person_klein_train.log | tail -40
echo '==== LAST 80 LINES AFTER TRAIN_START ===='
# print from last TRAIN_START
python3 - <<'PY'
from pathlib import Path
lines=Path('/work/loras_out/olh_person_klein_train.log').read_text(errors='replace').splitlines()
idx=0
for i,l in enumerate(lines):
    if 'TRAIN_START' in l: idx=i
print('\n'.join(lines[idx:idx+120]))
PY
echo '==== PROCS ===='
ps aux | grep -E 'continue_klein|flux_2|accelerate' | grep -v grep
""")
sftp.close()
_, so, se = c.exec_command("bash /tmp/train_err.sh", timeout=60)
print(so.read().decode())
c.close()
