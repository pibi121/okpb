#!/usr/bin/env python3
import os
import paramiko

PASSWORD = os.environ.get("GPUGO_PASS") or "C5FdcIQ5"
OUT = os.path.join(os.path.dirname(__file__), "_wan_inventory.txt")


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
df -h /workspace | tail -1
nvidia-smi --query-gpu=name,memory.total,memory.used --format=csv,noheader
supervisorctl status comfyui || true
echo "=== diffusion / unet ==="
ls -lh /workspace/models/diffusion_models/ 2>/dev/null | head -40
ls -lh /workspace/models/unet/ 2>/dev/null | head -20
echo "=== vae ==="
ls -lh /workspace/models/vae/ 2>/dev/null | head -20
echo "=== clip / text ==="
ls -lh /workspace/models/text_encoders/ /workspace/models/clip/ 2>/dev/null | head -40
echo "=== loras ==="
ls -lh /workspace/models/loras/ 2>/dev/null | head -20
echo "=== blueprints wan ==="
ls /opt/ComfyUI/blueprints/ 2>/dev/null | grep -iE 'wan|video|i2v' || true
ls /workspace/user/default/workflows/ 2>/dev/null | grep -iE 'wan|video|i2v' || true
echo "=== find wan files ==="
find /workspace/models -iname '*wan*' 2>/dev/null | head -40
echo "=== object_info Wan hints ==="
python3 - << 'PY'
import json, urllib.request
try:
  d=json.load(urllib.request.urlopen('http://127.0.0.1:9000/object_info', timeout=30))
  keys=[k for k in d if 'Wan' in k or 'wan' in k or 'I2V' in k or 'ImageToVideo' in k]
  print('keys', keys[:40])
except Exception as e:
  print('api', e)
PY
'''
    _, stdout, stderr = c.exec_command(cmd, timeout=90)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(out)
        if err:
            f.write("\nERR\n" + err)
    print(out[-4000:].encode("ascii", "replace").decode("ascii"))
    c.close()


if __name__ == "__main__":
    main()
