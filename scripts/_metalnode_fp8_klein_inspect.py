#!/usr/bin/env python3
from pathlib import Path
import paramiko, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (1).txt")
c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22024, username="root", pkey=pkey, timeout=90, allow_agent=False, look_for_keys=False, banner_timeout=90)
sftp = c.open_sftp()
with sftp.file("/tmp/fp8_klein.sh", "wb") as f:
    f.write(b"""#!/bin/bash
python3 - <<'PY'
from pathlib import Path
import subprocess
print('=== flux2 docs ===')
print(subprocess.getoutput("grep -n -i 'fp8\\|base\\|train\\|safetensors\\|klein' /work/train/musubi-tuner/docs/flux_2.md 2>/dev/null | head -80"))
print('=== advanced fp8 ===')
print(subprocess.getoutput("grep -n -i 'already\\|scaled\\|fp8_base\\|pre-quant\\|comfy' /work/train/musubi-tuner/docs/advanced_config.md 2>/dev/null | head -40"))
print('=== fp8 opt utils raise ===')
p=Path('/work/train/musubi-tuner/src/musubi_tuner/modules/fp8_optimization_utils.py')
t=p.read_text()
i=t.find('already in torch.float8')
print(t[max(0,i-800):i+600])
print('=== apply_fp8_monkey_patch ===')
i=t.find('def apply_fp8_monkey_patch')
print(t[i:i+1200])
# inspect keys in dit
from safetensors import safe_open
path='/work/train/models/flux-2-klein-base-9b-fp8.safetensors'
with safe_open(path, framework='pt') as f:
    keys=list(f.keys())
    print('nkeys', len(keys))
    sample=[k for k in keys if 'scale' in k][:8]
    print('scale_keys_sample', sample)
    wkey='double_blocks.0.img_mlp.0.weight'
    print('weight dtype', f.get_tensor(wkey).dtype, f.get_tensor(wkey).shape)
    sk='double_blocks.0.img_mlp.0.weight_scale'
    if sk in keys:
        print('weight_scale', f.get_tensor(sk).dtype, f.get_tensor(sk).shape, f.get_tensor(sk).flatten()[:4])
    ik='double_blocks.0.img_mlp.0.input_scale'
    if ik in keys:
        print('input_scale', f.get_tensor(ik).dtype, f.get_tensor(ik).shape, f.get_tensor(ik).flatten()[:4])
PY
""")
sftp.close()
_, so, se = c.exec_command("bash /tmp/fp8_klein.sh", timeout=90)
print(so.read().decode())
print(se.read().decode()[:2000])
c.close()
