#!/usr/bin/env python3
from pathlib import Path
import paramiko, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (1).txt")
c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22024, username="root", pkey=pkey, timeout=90, allow_agent=False, look_for_keys=False, banner_timeout=90)
cmd = r"""
# How musubi loads TE
python3 - <<'PY'
from pathlib import Path
p=Path('/work/train/musubi-tuner/src/musubi_tuner')
for f in sorted(p.glob('*flux2*'))+sorted(p.glob('*text*')):
  print(f.name)
PY
rg -n "text_encoder|from_pretrained|Qwen3|load_qwen|safetensors" /work/train/musubi-tuner/src/musubi_tuner/flux2_utils.py 2>/dev/null | head -50
echo '===='
rg -n "text_encoder|ArgumentParser|add_argument" /work/train/musubi-tuner/src/musubi_tuner/flux_2_cache_text_encoder_outputs.py 2>/dev/null | head -40
echo '==== PART SIZES ===='
ls -lh /work/train/models/qwen3-8b/*.part /work/train/models/qwen3-8b/*.safetensors 2>/dev/null
"""
_, so, se = c.exec_command(cmd, timeout=60)
print(so.read().decode())
c.close()
