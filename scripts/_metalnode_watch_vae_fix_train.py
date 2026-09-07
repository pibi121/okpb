#!/usr/bin/env python3
from pathlib import Path
import paramiko
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stdout.reconfigure(line_buffering=True)
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (1).txt")
SCR = Path(__file__).with_name("_metalnode_train_after_vae_fix.sh")


def connect():
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
    return c


def run(cmd, timeout=90):
    for attempt in range(5):
        try:
            c = connect()
            _, so, _ = c.exec_command(cmd, timeout=timeout)
            out = so.read().decode("utf-8", errors="replace")
            c.close()
            return out
        except Exception as e:
            print(f"ssh_err {attempt}: {e}", flush=True)
            time.sleep(10)
    return "SSH_FAIL"


def main():
    c = connect()
    sftp = c.open_sftp()
    sftp.put(str(SCR), "/tmp/train_after_vae_fix.sh")
    # also patch the long waiter script for future
    sftp.put(
        str(Path(__file__).with_name("_metalnode_run_klein_lora_train.sh")),
        "/tmp/run_klein_lora_train.sh",
    )
    sftp.close()
    _, so, _ = c.exec_command(
        "nohup bash /tmp/train_after_vae_fix.sh > /work/loras_out/olh_person_klein_train.nohup 2>&1 & echo PID:$!; sleep 8; tail -30 /work/loras_out/olh_person_klein_train.log",
        timeout=40,
    )
    print(so.read().decode(), flush=True)
    c.close()

    for i in range(240):
        time.sleep(45)
        out = run(
            r"""
python3 - <<'PY'
from pathlib import Path
import subprocess
log=Path('/work/loras_out/olh_person_klein_train.log')
text=log.read_text(errors='replace') if log.exists() else ''
for key in ['VAE_FIX','CACHE_LATENTS_OK','CACHE_LATENTS_FAIL','CACHE_TE_OK','CACHE_TE_FAIL','TRAIN_START','TRAIN_DONE','TRAIN_FAIL','INSTALLED','ALL_DONE','Traceback','RuntimeError']:
    lines=[ln for ln in text.splitlines() if key in ln]
    if lines:
        print('MARK', key, '::', lines[-1][-220:])
print('TAIL')
print('\n'.join(text.replace('\r','\n').splitlines()[-10:]))
procs=subprocess.getoutput("pgrep -af 'train_after_vae|flux_2_train|flux_2_cache' || true")
print('PROCS', (procs[:400] if procs else 'none'))
comfy=Path('/work/ComfyUI/models/loras/olh_person_klein.safetensors')
print('COMFY_LORA', comfy.exists(), comfy.stat().st_size if comfy.exists() else 0)
out=Path('/work/loras_out/olh_person_klein')
if out.exists():
    for p in sorted(out.glob('*.safetensors'), key=lambda p:p.stat().st_mtime, reverse=True)[:5]:
        print('LORA_FILE', p.name, p.stat().st_size)
PY
"""
        )
        print(f"=== {i} ===", flush=True)
        print(out[-1600:], flush=True)
        if "MARK ALL_DONE" in out and "COMFY_LORA True" in out:
            print("COMPLETE", flush=True)
            return
        if any(
            x in out
            for x in (
                "MARK CACHE_LATENTS_FAIL",
                "MARK CACHE_TE_FAIL",
                "MARK TRAIN_FAIL",
            )
        ):
            if "PROCS none" in out or ("flux_2_" not in out and "train_after_vae" not in out):
                print("FAILED", flush=True)
                return
    print("TIMEOUT", flush=True)


if __name__ == "__main__":
    main()
