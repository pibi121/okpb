#!/usr/bin/env python3
import os
from pathlib import Path

import paramiko

PASSWORD = os.environ.get("GPUGO_PASS") or "C5FdcIQ5"
OUT = Path(__file__).with_name("_wan_dl_status.txt")


def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(
        "95.165.71.177",
        port=42010,
        username="root",
        password=PASSWORD,
        timeout=60,
        allow_agent=False,
        look_for_keys=False,
    )
    _, stdout, stderr = c.exec_command(
        "python3 - <<'PY'\n"
        "import pathlib, subprocess, os\n"
        "r=subprocess.run(['pgrep','-af','wan_i2v_download'],capture_output=True,text=True)\n"
        "print('PROCS', (r.stdout or 'none').strip())\n"
        "files=[\n"
        " '/workspace/models/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors',\n"
        " '/workspace/models/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors',\n"
        " '/workspace/models/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors',\n"
        " '/workspace/models/vae/wan_2.1_vae.safetensors',\n"
        " '/workspace/models/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors',\n"
        " '/workspace/models/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors',\n"
        "]\n"
        "for f in files:\n"
        "  p=pathlib.Path(f)\n"
        "  part=pathlib.Path(f+'.part')\n"
        "  if p.exists():\n"
        "    print('OK', p.name, p.stat().st_size)\n"
        "  elif part.exists():\n"
        "    print('PART', p.name, part.stat().st_size)\n"
        "  else:\n"
        "    print('MISS', p.name)\n"
        "for p in ['/workspace/WAN_I2V_STATUS.txt','/workspace/WAN_I2V_DOWNLOAD.log']:\n"
        "  path=pathlib.Path(p)\n"
        "  if path.exists():\n"
        "    print('---', p, '---')\n"
        "    print(path.read_text(errors='replace')[-2000:])\n"
        "PY",
        timeout=60,
    )
    text = stdout.read().decode("utf-8", errors="replace")
    OUT.write_text(text, encoding="utf-8")
    print(text.encode("ascii", "replace").decode("ascii"))
    c.close()


if __name__ == "__main__":
    main()
