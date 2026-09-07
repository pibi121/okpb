#!/usr/bin/env python3
"""Poll Metalnode model download progress."""
from __future__ import annotations

import time
from pathlib import Path

import paramiko

HOST = "77.94.203.13"
PORT = 22024
KEY = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\metalnode_id_ed25519")


def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    for i in range(10):
        try:
            c.connect(HOST, port=PORT, username="root", pkey=pkey, timeout=60, allow_agent=False, look_for_keys=False)
            break
        except Exception as e:
            print("retry", i, e)
            time.sleep(3)
    else:
        raise SystemExit("ssh fail")

    _, so, _ = c.exec_command(
        "python3 - <<'PY'\n"
        "import os, subprocess\n"
        "from pathlib import Path\n"
        "st=os.statvfs('/work')\n"
        "print(f\"FREE {st.f_bavail*st.f_frsize/(1024**3):.1f}G\")\n"
        "r=subprocess.run(['pgrep','-af','metalnode_setup'],capture_output=True,text=True)\n"
        "print('PROCS', (r.stdout or 'none').strip()[:500])\n"
        "paths=[\n"
        " '/work/ComfyUI/models/diffusion_models/z_image_turbo_bf16.safetensors',\n"
        " '/work/ComfyUI/models/text_encoders/qwen_3_4b.safetensors',\n"
        " '/work/ComfyUI/models/vae/ae.safetensors',\n"
        " '/work/ComfyUI/models/diffusion_models/Wan2.2_Remix_NSFW_i2v_14b_high_lighting_fp8_e4m3fn_v3.0.safetensors',\n"
        " '/work/ComfyUI/models/diffusion_models/Wan2.2_Remix_NSFW_i2v_14b_low_lighting_fp8_e4m3fn_v3.0.safetensors',\n"
        " '/work/ComfyUI/models/text_encoders/nsfw_wan_umt5-xxl_fp8_scaled.safetensors',\n"
        " '/work/ComfyUI/models/vae/wan_2.1_vae.safetensors',\n"
        " '/work/ComfyUI/models/loras/olh_person_zimage.safetensors',\n"
        "]\n"
        "for f in paths:\n"
        " p=Path(f); part=Path(f+'.part')\n"
        " if p.exists(): print('OK', p.name, f'{p.stat().st_size/(1024**3):.2f}G')\n"
        " elif part.exists(): print('PART', p.name, f'{part.stat().st_size/(1024**3):.2f}G')\n"
        " else: print('MISS', Path(f).name)\n"
        "log=Path('/work/SETUP_DOWNLOAD.log')\n"
        "print('--- LOG ---')\n"
        "print(log.read_text(errors='replace')[-2000:] if log.exists() else 'none')\n"
        "stpath=Path('/work/SETUP_STATUS.txt')\n"
        "if stpath.exists():\n"
        " print('--- STATUS ---')\n"
        " print(stpath.read_text(errors='replace'))\n"
        "print('--- workflows ---')\n"
        "for p in sorted(Path('/work/ComfyUI/user/default/workflows').glob('*')):\n"
        " print(p.name, p.stat().st_size)\n"
        "print('--- comfy ---')\n"
        "r=subprocess.run(['pgrep','-af','main.py|comfy'],capture_output=True,text=True)\n"
        "print((r.stdout or 'no comfy')[:400])\n"
        "PY",
        timeout=60,
    )
    print(so.read().decode("utf-8", errors="replace"))
    c.close()


if __name__ == "__main__":
    main()
