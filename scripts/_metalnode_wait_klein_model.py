#!/usr/bin/env python3
from pathlib import Path
import paramiko
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (1).txt")
PART = "/work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors.part"
DEST = "/work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors"
URL = "https://huggingface.co/titomatus0203/flux-2-klein-9b-fp8/resolve/main/flux-2-klein-9b-fp8.safetensors"
MIN = 8_000_000_000


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


def run(c, cmd, timeout=60):
    _, so, se = c.exec_command(cmd, timeout=timeout)
    return so.read().decode("utf-8", errors="replace"), se.read().decode(
        "utf-8", errors="replace"
    )


def main():
    c = connect()
    # restart unlimited wget resume
    out, _ = run(
        c,
        f"""
export PATH=/usr/bin:/bin
pkill -f '{PART}' || true
pkill -f /tmp/install_klein.sh || true
sleep 2
nohup wget -4 -c --timeout=60 --tries=0 -O {PART} '{URL}' > /work/dl_klein.log 2>&1 &
echo PID:$!
sleep 2
ls -lh {PART} {DEST} 2>/dev/null
pgrep -a wget | head
""",
        timeout=60,
    )
    print(out)

    for i in range(90):
        time.sleep(45)
        out, _ = run(
            c,
            f"""
export PATH=/usr/bin:/bin
python3 - <<'PY'
from pathlib import Path
import subprocess
part = Path('{PART}')
dest = Path('{DEST}')
psz = part.stat().st_size if part.exists() else 0
dsz = dest.stat().st_size if dest.exists() else 0
running = subprocess.run(['pgrep','-f','flux-2-klein-9b-fp8.safetensors.part'], capture_output=True).returncode == 0
print(f'part={{psz}} dest={{dsz}} wget={{running}}')
if psz >= {MIN}:
    if running:
        subprocess.run(['pkill','-f','flux-2-klein-9b-fp8.safetensors.part'])
        import time; time.sleep(1)
    part.replace(dest)
    print('MOVED')
elif dsz >= {MIN}:
    print('DONE')
else:
    # restart wget if died
    if not running and psz < {MIN}:
        print('RESTART_NEEDED')
PY
ls -lh {PART} {DEST} 2>/dev/null | head
tail -c 180 /work/dl_klein.log 2>/dev/null | tr -d '\\r'
echo
""",
            timeout=60,
        )
        print(f"=== {i} ===")
        print(out[-800:])
        if "RESTART_NEEDED" in out:
            run(
                c,
                f"""
export PATH=/usr/bin:/bin
nohup wget -4 -c --timeout=60 --tries=0 -O {PART} '{URL}' > /work/dl_klein.log 2>&1 &
echo restarted:$!
""",
                timeout=30,
            )
        if "MOVED" in out or "DONE" in out:
            out, _ = run(
                c,
                """
export PATH=/usr/bin:/bin
cd /work/ComfyUI/models/diffusion_models
[ -e flux-2-klein-9b.safetensors ] || ln -s flux-2-klein-9b-fp8.safetensors flux-2-klein-9b.safetensors
{
  echo READY
  date -u
  ls -lh flux-2-klein-9b* ../text_encoders/qwen_3_8b* ../vae/flux2-vae* ../loras/klein_snofs* ../loras/lenovo_flux*
  ls -lh /work/ComfyUI/user/default/workflows/Flux2-Klein-9B-SNOFS-Lenovo.json
} | tee /work/INSTALL_KLEIN_STATUS.txt
""",
                timeout=30,
            )
            print(out)
            print("COMPLETE")
            break
    c.close()


if __name__ == "__main__":
    main()
