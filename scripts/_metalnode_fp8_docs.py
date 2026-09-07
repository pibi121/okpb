#!/usr/bin/env python3
from pathlib import Path
import paramiko, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (1).txt")
c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22024, username="root", pkey=pkey, timeout=90, allow_agent=False, look_for_keys=False, banner_timeout=90)
sftp = c.open_sftp()
with sftp.file("/tmp/fp8_docs.sh", "wb") as f:
    f.write(b"""#!/bin/bash
python3 - <<'PY'
from pathlib import Path
# load_flow_model
p=Path('/work/train/musubi-tuner/src/musubi_tuner/flux_2/flux2_utils.py')
t=p.read_text()
i=t.find('def load_flow_model')
print('=== load_flow_model ===')
print(t[i:i+2200])
print('=== fp8_base in train ===')
p2=Path('/work/train/musubi-tuner/src/musubi_tuner/flux_2_train_network.py')
t2=p2.read_text()
for line in t2.splitlines():
    if 'fp8' in line.lower() or 'weight_dtype' in line or 'dit_dtype' in line:
        print(line)
print('=== docs mention ===')
import subprocess
print(subprocess.getoutput("grep -rn 'fp8_base\\|fp8_scaled\\|weight_scale\\|already' /work/train/musubi-tuner/docs --include='*.md' 2>/dev/null | head -40"))
print('=== lora_utils fp8 check ===')
p3=Path('/work/train/musubi-tuner/src/musubi_tuner/utils/lora_utils.py')
t3=p3.read_text()
i=t3.find('def load_safetensors_with_lora_and_fp8')
print(t3[i:i+1800])
PY
echo '==== LOG FP8_BASE attempt ===='
grep -n 'TRAIN_START_FP8\\|fp8_base\\|already in torch.float8\\|TRAIN_FAIL\\|Unexpected key' /work/loras_out/olh_person_klein_train.log | tail -30
# kill current failed train retries if any
pgrep -af 'flux_2_train_network|train_only_klein' || true
""")
sftp.close()
_, so, se = c.exec_command("bash /tmp/fp8_docs.sh", timeout=60)
print(so.read().decode())
c.close()
