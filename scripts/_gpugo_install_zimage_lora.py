#!/usr/bin/env python3
"""Install trained LoRA into Comfy models and restart ComfyUI."""
import os
from pathlib import Path

import paramiko

PASSWORD = os.environ.get("GPUGO_PASS") or "C5FdcIQ5"
LOCAL_SAMPLES = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\datasets\olh_person_zimage\samples_preview")


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
    cmd = r'''
set -e
mkdir -p /workspace/models/loras
# install final + a mid checkpoint for A/B
cp -f /workspace/loras_out/olh_person_zimage/olh_person_zimage.safetensors /workspace/models/loras/olh_person_zimage.safetensors
cp -f /workspace/loras_out/olh_person_zimage/olh_person_zimage_000001500.safetensors /workspace/models/loras/olh_person_zimage_1500.safetensors
cp -f /workspace/loras_out/olh_person_zimage/olh_person_zimage_000002000.safetensors /workspace/models/loras/olh_person_zimage_2000.safetensors
ls -lh /workspace/models/loras/olh_person_zimage*.safetensors
supervisorctl start comfyui
sleep 5
supervisorctl status comfyui
'''
    _, stdout, stderr = c.exec_command(cmd, timeout=120)
    print(stdout.read().decode("utf-8", errors="replace"))
    print(stderr.read().decode("utf-8", errors="replace")[-500:])

    # download sample previews for epochs 1500/2000/2500
    LOCAL_SAMPLES.mkdir(parents=True, exist_ok=True)
    sftp = c.open_sftp()
    remote_dir = "/workspace/loras_out/olh_person_zimage/samples"
    for name in sftp.listdir(remote_dir):
        if name.endswith(".jpg") and (
            "_000001500_" in name or "_000002000_" in name or "_000002500_" in name
        ):
            sftp.get(f"{remote_dir}/{name}", str(LOCAL_SAMPLES / name))
            print("got", name)
    sftp.close()
    c.close()
    print("DONE")


if __name__ == "__main__":
    main()
