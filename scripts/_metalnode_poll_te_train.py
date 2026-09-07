#!/usr/bin/env python3
"""Poll Metalnode Klein TE download + train until ALL_DONE or failure."""
from pathlib import Path
import paramiko
import sys
import time
import re

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (1).txt")
HOST, PORT = "77.94.203.13", 22024

POLL = r"""
python3 - <<'PY'
from pathlib import Path
import subprocess, re
log=Path('/work/loras_out/olh_person_klein_train.log')
text=log.read_text(errors='replace') if log.exists() else ''
# only markers after CONTINUE (16:00+)
lines=text.splitlines()
cont_i=0
for i,l in enumerate(lines):
    if any(x in l for x in ('CONTINUE_START','===== CONTINUE','TRAIN_ONLY_START','===== TRAIN_ONLY','TRAIN_BF16_START','===== TRAIN_BF16','DEQUANT_')):
        cont_i=i
marks=[l for l in lines[cont_i:] if re.search(r'QWEN_READY|CACHE_TE_OK|CACHE_TE_FAIL|TRAIN_START|TRAIN_DONE|ALL_DONE|TRAIN_FAIL|TE_MISSING|QWEN_INCOMPLETE|TRAIN_ONLY|TRAIN_BF16|DEQUANT_', l)]
print('MARKERS:', ' | '.join(marks[-6:]) if marks else 'none')
ps=subprocess.getoutput("ps aux | grep -E 'dl_qwen3_curl|continue_klein|flux_2_|accelerate|dequant_dit|train_bf16' | grep -v grep | wc -l")
print('PROCS:', ps.strip())
print('QWEN_DU:', subprocess.getoutput("du -sh /work/train/models/qwen3-8b 2>/dev/null | awk '{print $1}'").strip())
print('SHARDS:', subprocess.getoutput("ls /work/train/models/qwen3-8b/model-*-of-*.safetensors 2>/dev/null | wc -l").strip())
print('BF16:', subprocess.getoutput("ls -lh /work/train/models/flux-2-klein-base-9b-bf16.safetensors 2>/dev/null || echo none").strip().splitlines()[-1])
lora=subprocess.getoutput("ls -lh /work/ComfyUI/models/loras/olh_person_klein.safetensors 2>/dev/null || echo none")
print('LORA:', lora.strip().splitlines()[-1] if lora else 'none')
print('LAST:', ' // '.join(lines[-3:]))
te=subprocess.getoutput("ls /work/datasets/olh_person_klein/cache/*_te.safetensors 2>/dev/null | wc -l")
print('TE_CACHE:', te.strip())
PY
"""


def ssh():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c.connect(
        HOST, port=PORT, username="root", pkey=pkey, timeout=90,
        allow_agent=False, look_for_keys=False, banner_timeout=90,
    )
    return c


def main():
    deadline = time.time() + 4 * 3600
    last_print = ""
    while time.time() < deadline:
        try:
            c = ssh()
            _, so, _ = c.exec_command(POLL, timeout=60)
            out = so.read().decode("utf-8", "replace").strip()
            c.close()
        except Exception as e:
            print(f"SSH_ERR {e}", flush=True)
            time.sleep(30)
            continue
        if out != last_print:
            print(f"[{time.strftime('%H:%M:%S')}] {out}", flush=True)
            last_print = out
        if "ALL_DONE" in out and "olh_person_klein.safetensors" in out and "none" not in out:
            # more careful: LORA line should not be 'none'
            if re.search(r"LORA:.*olh_person_klein\.safetensors", out):
                print("SUCCESS", flush=True)
                return 0
        # failure only on NEW markers after CONTINUE
        if re.search(r"CACHE_TE_FAIL2|TRAIN_FAIL|TE_MISSING|QWEN_INCOMPLETE", out):
            if "PROCS:0" in out:
                print("FAILED_IDLE", flush=True)
                return 1
        if "CACHE_TE_FAIL" in out and "CACHE_TE_OK" not in out and "PROCS:0" in out:
            # waiter's retry might still be running — only fail if idle
            print("FAILED_TE_IDLE", flush=True)
            return 1
        time.sleep(45)
    print("TIMEOUT", flush=True)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
