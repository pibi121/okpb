#!/usr/bin/env python3
import os
import time

import paramiko

PASSWORD = os.environ["GPUGO_PASS"]
OUT = os.path.join(os.path.dirname(__file__), "_caa_out.txt")


def connect():
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
        banner_timeout=60,
    )
    return c


def run(cmd, timeout=300):
    c = connect()
    try:
        print(">>>", cmd[:100].replace("\n", " "), flush=True)
        _, stdout, stderr = c.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode(errors="replace")
        err = stderr.read().decode(errors="replace")
        with open(OUT, "a", encoding="utf-8") as f:
            f.write(out)
            if err:
                f.write("\nERR\n" + err)
        print((out or "")[-600:], flush=True)
        return out
    finally:
        c.close()


open(OUT, "w", encoding="utf-8").write("start\n")

run(
    r"""
export GIT_TERMINAL_PROMPT=0
cd /workspace/custom_nodes
if [ ! -d ControlAltAI-Nodes ]; then
  git -c credential.helper= clone --depth 1 https://github.com/gseth/ControlAltAI-Nodes.git ControlAltAI-Nodes
else
  echo exists
fi
ls ControlAltAI-Nodes | head
"""
)

run("supervisorctl restart comfyui")
time.sleep(35)

run(
    r"""
python3 - << 'PY'
import json, urllib.request, time
d=None
for i in range(25):
  try:
    d=json.load(urllib.request.urlopen('http://127.0.0.1:9000/object_info', timeout=30)); break
  except Exception as e:
    print('wait', e); time.sleep(2)
need=['FluxResolutionNode','SeedVR2VideoUpscaler','Image Lucy Sharpen','Image Bloom Filter','FaceDetailer','Power Lora Loader (rgthree)']
print('HAVE', [n for n in need if n in d])
print('MISS', [n for n in need if n not in d])
# grep log for ControlAlt
import subprocess
r=subprocess.getoutput("grep -E 'ControlAlt|FluxResolution|IMPORT FAILED' /opt/ComfyUI/user/comfyui_9000.log | tail -20")
print(r)
PY
"""
)

run(
    r"""
cat > /workspace/ALLINONE_STATUS.txt << 'EOF'
Z-Image All-in-One READY

Workflow: user/default/workflows/Z-Image-ALLinONE-v2.json
UNET: z_image_turbo_bf16.safetensors
VAE: ae.safetensors

Nodes OK: FaceDetailer, Power Lora, SeedVR2*, Lucy Sharpen, Bloom, ColorCorrect, LayerStyle, FluxResolution, KJ Set/Get, rgthree

Do this:
1. F5
2. Load Z-Image-ALLinONE-v2
3. First run: Bypass SeedVR + NSFW LoRA groups if any missing models
4. Queue Prompt
5. Then enable FaceDetailer / SeedVR (models may auto-download)

LoRAs from the video are not on disk yet - leave empty or download from Civitai.
EOF
cat /workspace/ALLINONE_STATUS.txt
"""
)
print("DONE")
