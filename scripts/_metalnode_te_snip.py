#!/usr/bin/env python3
from pathlib import Path
import paramiko, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (1).txt")
c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22024, username="root", pkey=pkey, timeout=90, allow_agent=False, look_for_keys=False, banner_timeout=90)
sftp = c.open_sftp()
with sftp.file("/tmp/te_snip.sh", "w") as f:
    f.write("""
sed -n '780,900p' /work/train/musubi-tuner/src/musubi_tuner/flux_2/flux2_utils.py
echo '==== STATUS ===='
ls -lh /work/train/models/qwen3-8b/
tail -40 /work/loras_out/olh_person_klein_train.log
ps aux | grep -E 'continue_klein|flux_2_|dl_qwen' | grep -v grep
""")
sftp.close()
_, so, _ = c.exec_command("bash /tmp/te_snip.sh", timeout=60)
print(so.read().decode())
c.close()
