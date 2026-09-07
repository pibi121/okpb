#!/usr/bin/env python3
import os
import paramiko

HOST = os.environ.get("GPUGO_HOST", "95.165.71.177")
PORT = int(os.environ.get("GPUGO_PORT", "42010"))
USER = os.environ.get("GPUGO_USER", "root")
PASSWORD = os.environ["GPUGO_PASS"]

CMD = r"""
SRC=/opt/ComfyUI/.venv/lib/python3.12/site-packages/comfyui_workflow_templates_media_image/templates/flux_dev_full_text_to_image.json
mkdir -p /workspace/user/default/workflows /opt/ComfyUI/blueprints
cp "$SRC" "/workspace/user/default/workflows/Text to Image (Flux UltraReal).json"
cp "$SRC" "/opt/ComfyUI/blueprints/Text to Image (Flux UltraReal).json"
cp "$SRC" /workspace/user/default/workflows/Flux-UltraReal.json
ls -lh /workspace/models/diffusion_models/
ls -lh /workspace/models/text_encoders/
ls -la /workspace/user/default/workflows/ | grep -iE 'flux|ultra|z-image'
"""

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=45, allow_agent=False, look_for_keys=False)
stdin, stdout, stderr = client.exec_command(CMD, get_pty=True)
print(stdout.read().decode(errors="replace"))
print(stderr.read().decode(errors="replace"))
client.close()
