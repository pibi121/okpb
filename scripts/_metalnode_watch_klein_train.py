#!/usr/bin/env python3
"""Poll Klein LoRA train until real completion markers."""
from pathlib import Path
import paramiko
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stdout.reconfigure(line_buffering=True)
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (1).txt")

STATUS = r"""
export PATH=/usr/bin:/bin
python3 - <<'PY'
from pathlib import Path
import subprocess
part=Path('/work/train/models/flux-2-klein-base-9b-fp8.safetensors.part')
dit=Path('/work/train/models/flux-2-klein-base-9b-fp8.safetensors')
print('PART', part.stat().st_size if part.exists() else 0)
print('DIT', dit.stat().st_size if dit.exists() else 0)
curl=subprocess.getoutput("pgrep -c curl || true")
print('CURL', curl.strip() or '0')
procs=subprocess.getoutput("pgrep -af 'run_klein_lora_train|flux_2_train_network|flux_2_cache' || true")
print('PROCS')
print(procs[:500] if procs else 'none')
log=Path('/work/loras_out/olh_person_klein_train.log')
if log.exists():
    text=log.read_text(errors='replace')
    for key in ['WAIT_DIT','DIT_OK','CACHE_LATENTS','CACHE_TE','TRAIN_START','TRAIN_DONE','INSTALLED','ALL_DONE','Traceback','Error']:
        # last occurrence line
        lines=[ln for ln in text.splitlines() if key in ln]
        if lines:
            print('MARK', key, '::', lines[-1][-180:])
    print('TAIL')
    print('\n'.join(text.replace('\r','\n').splitlines()[-6:]))
out=Path('/work/loras_out/olh_person_klein')
if out.exists():
    safes=sorted(out.glob('*.safetensors'), key=lambda p:p.stat().st_mtime, reverse=True)
    for p in safes[:5]:
        print('LORA', p.name, p.stat().st_size)
comfy=Path('/work/ComfyUI/models/loras/olh_person_klein.safetensors')
print('COMFY_LORA', comfy.exists(), comfy.stat().st_size if comfy.exists() else 0)
PY
"""


def run(cmd, timeout=90):
    for attempt in range(4):
        try:
            c = paramiko.SSHClient()
            c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
            c.connect(
                "77.94.203.13",
                port=22024,
                username="root",
                pkey=pkey,
                timeout=60,
                allow_agent=False,
                look_for_keys=False,
                banner_timeout=60,
            )
            _, so, _ = c.exec_command(cmd, timeout=timeout)
            out = so.read().decode("utf-8", errors="replace")
            c.close()
            return out
        except Exception as e:
            print(f"ssh_err {attempt}: {e}", flush=True)
            time.sleep(15)
    return "SSH_FAIL"


def main():
    for i in range(300):
        out = run(STATUS)
        print(f"=== {i} ===", flush=True)
        print(out[-1500:], flush=True)
        if "MARK ALL_DONE" in out or ("MARK TRAIN_DONE" in out and "COMFY_LORA True" in out):
            print("COMPLETE", flush=True)
            return
        if "MARK Traceback" in out and "MARK ALL_DONE" not in out:
            # keep going unless train process died
            if "PROCS\nnone" in out or "PROCS\n\n" in out:
                print("FAILED", flush=True)
                return
        time.sleep(60)
    print("TIMEOUT", flush=True)


if __name__ == "__main__":
    main()
