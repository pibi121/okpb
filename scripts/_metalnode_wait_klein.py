#!/usr/bin/env python3
from pathlib import Path
import paramiko
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (1).txt")
FINALIZE = Path(__file__).with_name("_metalnode_finalize_klein.sh")


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


def main():
    c = connect()
    sftp = c.open_sftp()
    sftp.put(str(FINALIZE), "/tmp/finalize_klein.sh")
    sftp.close()

    for i in range(40):
        _, so, _ = c.exec_command("bash /tmp/finalize_klein.sh", timeout=60)
        out = so.read().decode("utf-8", errors="replace")
        print(f"=== round {i} ===")
        print(out[-2000:])
        # Always verify sizes each round
        if True:
            _, so, _ = c.exec_command(
                """
export PATH=/usr/bin:/bin
python3 - <<'PY'
from pathlib import Path
need = {
  Path('/work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors'): 8_000_000_000,
  Path('/work/ComfyUI/models/text_encoders/qwen_3_8b_fp8mixed.safetensors'): 7_000_000_000,
  Path('/work/ComfyUI/models/vae/flux2-vae.safetensors'): 300_000_000,
  Path('/work/ComfyUI/models/loras/klein_snofs_v1_4.safetensors'): 900_000_000,
  Path('/work/ComfyUI/models/loras/lenovo_flux_klein9b.safetensors'): 100_000_000,
}
ok=True
for p,m in need.items():
  sz=p.stat().st_size if p.exists() else 0
  print(('OK' if sz>=m else 'MISS'), p.name, sz)
  if sz<m: ok=False
# fp4 optional
p=Path('/work/ComfyUI/models/text_encoders/qwen_3_8b_fp4mixed.safetensors')
print(('OK' if p.exists() and p.stat().st_size>5e9 else 'OPT'), 'qwen_3_8b_fp4mixed', p.stat().st_size if p.exists() else 0)
print('ALL_READY' if ok else 'WAIT')
PY
""",
                timeout=30,
            )
            check = so.read().decode("utf-8", errors="replace")
            print(check)
            if "ALL_READY" in check:
                _, so, _ = c.exec_command(
                    """
export PATH=/usr/bin:/bin
cd /work/ComfyUI/models/diffusion_models
[ -e flux-2-klein-9b.safetensors ] || ln -s flux-2-klein-9b-fp8.safetensors flux-2-klein-9b.safetensors
{
  echo READY
  date -u
  ls -lh flux-2-klein-9b* ../text_encoders/qwen_3_8b* ../vae/flux2-vae* ../loras/klein_snofs* ../loras/lenovo_flux*
  ls -lh /work/ComfyUI/user/default/workflows/Flux2-Klein-9B-SNOFS-Lenovo.json
} > /work/INSTALL_KLEIN_STATUS.txt
cat /work/INSTALL_KLEIN_STATUS.txt
""",
                    timeout=30,
                )
                print(so.read().decode("utf-8", errors="replace"))
                print("COMPLETE")
                break
        time.sleep(60)
    c.close()


if __name__ == "__main__":
    main()
