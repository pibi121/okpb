#!/usr/bin/env python3
"""Upload scripts, bootstrap continue, watch until ALL_DONE."""
from pathlib import Path
import paramiko
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stdout.reconfigure(line_buffering=True)

KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (1).txt")
SCRIPTS = Path(__file__).resolve().parent
FILES = {
    "_metalnode_quick_train_status.sh": "/tmp/quick_train_status.sh",
    "_metalnode_dl_dit_resume.sh": "/tmp/dl_dit_resume.sh",
    "_metalnode_run_klein_lora_train.sh": "/tmp/run_klein_lora_train.sh",
    "_metalnode_bootstrap_train_continue.sh": "/tmp/bootstrap_train_continue.sh",
}


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


def run(cmd, timeout=120):
    for attempt in range(5):
        try:
            c = connect()
            _, so, se = c.exec_command(cmd, timeout=timeout)
            out = so.read().decode("utf-8", errors="replace")
            err = se.read().decode("utf-8", errors="replace")
            c.close()
            return out, err
        except Exception as e:
            print(f"ssh_err {attempt}: {e}", flush=True)
            time.sleep(12)
    return "SSH_FAIL", ""


STATUS_PY = r"""
python3 - <<'PY'
from pathlib import Path
import subprocess
part=Path('/work/train/models/flux-2-klein-base-9b-fp8.safetensors.part')
dit=Path('/work/train/models/flux-2-klein-base-9b-fp8.safetensors')
print('PART', part.stat().st_size if part.exists() else 0)
print('DIT', dit.stat().st_size if dit.exists() else 0)
print('CURL', subprocess.getoutput('pgrep -c curl || true').strip() or '0')
procs=subprocess.getoutput("pgrep -af 'run_klein_lora_train|flux_2_train_network|flux_2_cache|dl_dit_resume' || true")
print('PROCS_BEGIN')
print(procs[:800] if procs else 'none')
print('PROCS_END')
log=Path('/work/loras_out/olh_person_klein_train.log')
if log.exists():
    text=log.read_text(errors='replace')
    for key in ['WAITER_START','WAIT_DIT','DIT_OK','CACHE_LATENTS','CACHE_TE','TRAIN_START','TRAIN_DONE','INSTALLED','ALL_DONE','DIT_MISSING','FAIL','Traceback']:
        lines=[ln for ln in text.splitlines() if key in ln]
        if lines:
            print('MARK', key, '::', lines[-1][-200:])
    print('TAIL')
    print('\n'.join(text.replace('\r','\n').splitlines()[-8:]))
out=Path('/work/loras_out/olh_person_klein')
if out.exists():
    for p in sorted(out.glob('*.safetensors'), key=lambda p:p.stat().st_mtime, reverse=True)[:5]:
        print('LORA_FILE', p.name, p.stat().st_size)
comfy=Path('/work/ComfyUI/models/loras/olh_person_klein.safetensors')
print('COMFY_LORA', comfy.exists(), comfy.stat().st_size if comfy.exists() else 0)
PY
"""


def main():
    c = connect()
    sftp = c.open_sftp()
    for local, remote in FILES.items():
        sftp.put(str(SCRIPTS / local), remote)
        print(f"uploaded {local}", flush=True)
    sftp.close()
    _, so, _ = c.exec_command("bash /tmp/bootstrap_train_continue.sh", timeout=60)
    print(so.read().decode("utf-8", errors="replace")[-4000:], flush=True)
    c.close()

    for i in range(360):
        time.sleep(45)
        out, _ = run(STATUS_PY, timeout=90)
        print(f"=== {i} ===", flush=True)
        print(out[-1800:] if out else "empty", flush=True)
        if "MARK ALL_DONE" in out and "COMFY_LORA True" in out:
            print("COMPLETE", flush=True)
            return
        if "MARK DIT_MISSING" in out and "PROCS_BEGIN\nnone" in out.replace("\r", ""):
            # waiter died without dit - try relaunch once
            print("RELAUNCH_AFTER_DIT_MISSING", flush=True)
            run("bash /tmp/bootstrap_train_continue.sh", timeout=60)
        if any(x in out for x in ("MARK CACHE_LATENTS_FAIL", "MARK CACHE_TE_FAIL2", "MARK TRAIN_FAIL", "MARK NO_LORA_FILE")):
            if "run_klein_lora_train" not in out:
                print("FAILED", flush=True)
                return
    print("TIMEOUT", flush=True)


if __name__ == "__main__":
    main()
