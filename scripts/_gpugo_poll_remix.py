#!/usr/bin/env python3
"""Poll Remix download progress on GPUGO."""
from __future__ import annotations

import os
import time

import paramiko

PASSWORD = os.environ.get("GPUGO_PASS") or "C5FdcIQ5"


def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    for i in range(10):
        try:
            c.connect(
                "95.165.71.177",
                port=42010,
                username="root",
                password=PASSWORD,
                timeout=60,
                allow_agent=False,
                look_for_keys=False,
                banner_timeout=60,
            )
            break
        except Exception as e:
            print("retry", i, e, flush=True)
            time.sleep(3)
    else:
        raise SystemExit("ssh fail")

    _, so, _ = c.exec_command(
        "python3 - <<'PY'\n"
        "import os, subprocess\n"
        "from pathlib import Path\n"
        "st=os.statvfs('/workspace')\n"
        "print(f\"FREE {st.f_bavail*st.f_frsize/(1024**3):.1f}G\")\n"
        "r=subprocess.run(['pgrep','-af','install_remix'],capture_output=True,text=True)\n"
        "print('PROCS', (r.stdout or 'none').strip()[:400])\n"
        "paths=[\n"
        " '/workspace/models/diffusion_models/Wan2.2_Remix_NSFW_i2v_14b_high_lighting_fp8_e4m3fn_v3.0.safetensors',\n"
        " '/workspace/models/diffusion_models/Wan2.2_Remix_NSFW_i2v_14b_low_lighting_fp8_e4m3fn_v3.0.safetensors',\n"
        " '/workspace/models/text_encoders/nsfw_wan_umt5-xxl_fp8_scaled.safetensors',\n"
        "]\n"
        "for f in paths:\n"
        " p=Path(f); part=Path(f+'.part')\n"
        " if p.exists(): print('OK', p.name, f'{p.stat().st_size/(1024**3):.2f}G')\n"
        " elif part.exists(): print('PART', p.name, f'{part.stat().st_size/(1024**3):.2f}G')\n"
        " else: print('MISS', Path(f).name)\n"
        "log=Path('/workspace/REMIX_DOWNLOAD.log')\n"
        "print('--- LOG ---')\n"
        "print(log.read_text(errors='replace')[-1800:] if log.exists() else 'none')\n"
        "stpath=Path('/workspace/REMIX_STATUS.txt')\n"
        "if stpath.exists():\n"
        " print('--- STATUS ---')\n"
        " print(stpath.read_text(errors='replace'))\n"
        "PY",
        timeout=60,
    )
    print(so.read().decode("utf-8", errors="replace"))
    c.close()


if __name__ == "__main__":
    main()
