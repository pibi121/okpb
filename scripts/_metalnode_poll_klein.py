#!/usr/bin/env python3
"""Upload and run parallel Klein downloads; poll main installer."""
from pathlib import Path
import paramiko
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (1).txt")
PARALLEL = Path(__file__).with_name("_metalnode_install_klein_parallel.sh")
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
        timeout=60,
        allow_agent=False,
        look_for_keys=False,
    )
    return c


def run(c, cmd, timeout=60):
    _, so, se = c.exec_command(cmd, timeout=timeout)
    out = so.read().decode("utf-8", errors="replace")
    err = se.read().decode("utf-8", errors="replace")
    return out, err


def main():
    c = connect()
    sftp = c.open_sftp()
    sftp.put(str(PARALLEL), "/tmp/install_klein_parallel.sh")
    sftp.close()
    out, err = run(c, "bash /tmp/install_klein_parallel.sh", timeout=30)
    print(out)
    if err:
        print("ERR", err[:500])

    # poll a few times
    for i in range(24):
        out, _ = run(
            c,
            r"""
export PATH=/usr/bin:/bin
echo === poll ===
ls -lh /work/ComfyUI/models/diffusion_models/*klein* /work/ComfyUI/models/diffusion_models/*.part 2>/dev/null
ls -lh /work/ComfyUI/models/text_encoders/qwen_3_8b* /work/ComfyUI/models/text_encoders/*.part 2>/dev/null
ls -lh /work/ComfyUI/models/vae/flux2* /work/ComfyUI/models/vae/*.part 2>/dev/null
ls -lh /work/ComfyUI/models/loras/klein* /work/ComfyUI/models/loras/lenovo_flux* /work/ComfyUI/models/loras/*.part 2>/dev/null
pgrep -c wget; tail -3 /work/INSTALL_KLEIN.log 2>/dev/null
""",
            timeout=30,
        )
        print(out[-2500:])
        # finalize completed .part files
        run(
            c,
            r"""
export PATH=/usr/bin:/bin
finalize() {
  part="$1"; dest="$2"; min="$3"
  if [ -f "$part" ] && [ ! -f "$dest" ]; then
    sz=$(stat -c%s "$part" 2>/dev/null)
    if [ -n "$sz" ] && [ "$sz" -ge "$min" ]; then
      # only move if wget for this part is gone
      if ! pgrep -f "$part" >/dev/null 2>&1; then
        mv -f "$part" "$dest"
        echo FINALIZED "$dest" "$sz"
      fi
    fi
  fi
}
finalize /work/ComfyUI/models/vae/flux2-vae.safetensors.part /work/ComfyUI/models/vae/flux2-vae.safetensors 300000000
finalize /work/ComfyUI/models/loras/lenovo_flux_klein9b.safetensors.part /work/ComfyUI/models/loras/lenovo_flux_klein9b.safetensors 100000000
finalize /work/ComfyUI/models/loras/klein_snofs_v1_4.safetensors.part /work/ComfyUI/models/loras/klein_snofs_v1_4.safetensors 900000000
finalize /work/ComfyUI/models/text_encoders/qwen_3_8b_fp8mixed.safetensors.part /work/ComfyUI/models/text_encoders/qwen_3_8b_fp8mixed.safetensors 7000000000
finalize /work/ComfyUI/models/text_encoders/qwen_3_8b_fp4mixed.safetensors.part /work/ComfyUI/models/text_encoders/qwen_3_8b_fp4mixed.safetensors 5000000000
finalize /work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors.part /work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors 8000000000
""",
            timeout=30,
        )
        if "flux-2-klein-9b-fp8.safetensors" in out and ".part" not in out.split("klein")[0]:
            # rough check - keep polling until no wget
            pass
        # stop early if no wget and all files present
        if "0\n" in out[-20:] or out.strip().endswith("0"):
            # check READY-ish
            check, _ = run(
                c,
                r"""
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
print('ALL_READY' if ok else 'WAIT')
PY
""",
                timeout=30,
            )
            print(check)
            if "ALL_READY" in check:
                run(
                    c,
                    r"""
export PATH=/usr/bin:/bin
cd /work/ComfyUI/models/diffusion_models
if [ -f flux-2-klein-9b-fp8.safetensors ] && [ ! -e flux-2-klein-9b.safetensors ]; then
  ln -s flux-2-klein-9b-fp8.safetensors flux-2-klein-9b.safetensors
fi
printf 'READY\n' > /work/INSTALL_KLEIN_STATUS.txt
ls -lh flux-2-klein-9b* ../text_encoders/qwen_3_8b* ../vae/flux2-vae* ../loras/klein_snofs* ../loras/lenovo_flux* >> /work/INSTALL_KLEIN_STATUS.txt
""",
                    timeout=30,
                )
                print("DONE READY")
                break
        time.sleep(45)
    c.close()


if __name__ == "__main__":
    main()
