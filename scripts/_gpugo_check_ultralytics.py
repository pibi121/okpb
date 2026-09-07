#!/usr/bin/env python3
import json
import os
import urllib.request

import paramiko

PASSWORD = os.environ.get("GPUGO_PASS") or "C5FdcIQ5"


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
ls -lh /workspace/models/ultralytics/bbox/
echo "---"
# how Comfy lists ultralytics
python3 << 'PY'
import json, urllib.request
# try object_info for UltralyticsDetectorProvider
d=json.load(urllib.request.urlopen('http://127.0.0.1:9000/object_info/UltralyticsDetectorProvider', timeout=30))
info=d.get('UltralyticsDetectorProvider') or d
# dig for model list
s=json.dumps(info)
# print input combo options if any
inputs=(info.get('input') or {}).get('required') or {}
print('required keys', list(inputs.keys()))
for k,v in inputs.items():
  print(' ', k, type(v).__name__, str(v)[:500])
PY
echo "--- extra paths ---"
cat /opt/ComfyUI/extra_model_paths.yaml 2>/dev/null | head -80
'''
    _, stdout, stderr = c.exec_command(cmd, timeout=60)
    print(stdout.read().decode(errors="replace"))
    print(stderr.read().decode(errors="replace"))
    c.close()


if __name__ == "__main__":
    main()
