#!/usr/bin/env python3
"""Start ACE-Step AIO download + list Workbench/DJ node files + restart Comfy."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "77.94.203.13"
PORT = 22022
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")
USER = "root"

REMOTE = r'''#!/bin/bash
set -e

echo "=== NODE FILES ==="
ls /work/ComfyUI/custom_nodes/ComfyUI-Video-Workbench/
ls /work/ComfyUI/custom_nodes/DJ_VideoAudioMixer/
rg -n "NODE_CLASS_MAPPINGS|class " /work/ComfyUI/custom_nodes/ComfyUI-Video-Workbench/*.py 2>/dev/null | head -40
rg -n "NODE_CLASS_MAPPINGS|class " /work/ComfyUI/custom_nodes/DJ_VideoAudioMixer/*.py 2>/dev/null | head -40

echo "=== ACE MODEL CANDIDATES ON HF (via curl headers) ==="
# AIO turbo
URL1="https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files/resolve/main/ace_step_1.5_turbo_aio.safetensors"
URL2="https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files/resolve/main/checkpoints/ace_step_1.5_turbo_aio.safetensors"
URL3="https://huggingface.co/Comfy-Org/ace_step_v1_5_ComfyUI_files/resolve/main/ace_step_1.5_turbo_aio.safetensors"
# also v1 classic
URL4="https://huggingface.co/Comfy-Org/ace_step_ComfyUI_files/resolve/main/ace_step_v1_3.5b.safetensors"

for u in "$URL1" "$URL2" "$URL3" "$URL4"; do
  code=$(curl -sI -o /dev/null -w "%{http_code}" -L "$u" | tail -1)
  echo "$code $u"
done

# list HF api
echo "=== HF API tree ==="
curl -sL "https://huggingface.co/api/models/Comfy-Org/ace_step_1.5_ComfyUI_files/tree/main" | python3 -c "import sys,json; d=json.load(sys.stdin);
[print(x.get('path'), x.get('size')) for x in d]" 2>/dev/null || curl -sL "https://huggingface.co/api/models/Comfy-Org/ace_step_1.5_ComfyUI_files/tree/main" | head -c 2000

echo
curl -sL "https://huggingface.co/api/models/Comfy-Org/ace_step_ComfyUI_files/tree/main" | python3 -c "import sys,json; d=json.load(sys.stdin);
[print(x.get('path'), x.get('size')) for x in d]" 2>/dev/null | head -40
'''


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    client.connect(HOST, port=PORT, username=USER, pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
    sftp = client.open_sftp()
    with sftp.file("/work/_ace_lookup.sh", "w") as f:
        f.write(REMOTE)
    sftp.close()
    stdin, stdout, stderr = client.exec_command("bash /work/_ace_lookup.sh", timeout=120)
    print(stdout.read().decode(errors="replace"))
    err = stderr.read().decode(errors="replace")
    if err.strip():
        print("STDERR:", err[-2000:])
    client.close()


if __name__ == "__main__":
    main()
