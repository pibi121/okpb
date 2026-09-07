#!/usr/bin/env python3
from pathlib import Path
import paramiko
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stdout.reconfigure(line_buffering=True)

KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (1).txt")
SCR = Path(__file__).with_name("_metalnode_klein_finish.sh")
EXPECT = 9433061528


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


def run(c, cmd, timeout=120):
    _, so, se = c.exec_command(cmd, timeout=timeout)
    return so.read().decode("utf-8", errors="replace"), se.read().decode(
        "utf-8", errors="replace"
    )


def main():
    c = connect()
    sftp = c.open_sftp()
    sftp.put(str(SCR), "/tmp/klein_finish.sh")
    sftp.close()
    out, _ = run(c, "bash /tmp/klein_finish.sh", timeout=60)
    print(out, flush=True)

    for i in range(80):
        time.sleep(30)
        out, _ = run(
            c,
            f"""
export PATH=/usr/bin:/bin
python3 - <<'PY'
from pathlib import Path
import subprocess
p=Path('/work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors')
sz=p.stat().st_size if p.exists() else 0
aria=subprocess.run(['pgrep','-af','aria2c'],capture_output=True,text=True)
print('size', sz, 'expect', {EXPECT})
print('aria', (aria.stdout or 'none')[:180])
if sz>={EXPECT}:
    print('DONE')
elif 'aria2c' not in (aria.stdout or ''):
    print('NEED_RESUME')
PY
tail -c 180 /work/dl_klein_aria.log 2>/dev/null | tr -d '\\r'; echo
""",
            timeout=60,
        )
        print(f"=== {i} ===", flush=True)
        print(out[-600:], flush=True)
        if "NEED_RESUME" in out:
            out2, _ = run(c, "bash /tmp/klein_finish.sh", timeout=60)
            print(out2[-400:], flush=True)
        if "DONE" in out:
            out, _ = run(
                c,
                """
export PATH=/usr/bin:/bin
cd /work/ComfyUI/models/diffusion_models
pkill -f 'aria2c.*flux-2-klein' || true
[ -e flux-2-klein-9b.safetensors ] || ln -sf flux-2-klein-9b-fp8.safetensors flux-2-klein-9b.safetensors
{
  echo READY
  date -u
  ls -lh flux-2-klein-9b* ../text_encoders/qwen_3_8b* ../vae/flux2-vae* ../loras/klein_snofs* ../loras/lenovo_flux*
  ls -lh /work/ComfyUI/user/default/workflows/Flux2-Klein-9B-SNOFS-Lenovo.json
} | tee /work/INSTALL_KLEIN_STATUS.txt
""",
                timeout=30,
            )
            print(out, flush=True)
            print("COMPLETE", flush=True)
            break
    c.close()


if __name__ == "__main__":
    main()
