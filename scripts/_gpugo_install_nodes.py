#!/usr/bin/env python3
"""Install missing custom nodes for Z-Image All-in-One on remote."""
from __future__ import annotations

import os
import time

import paramiko

HOST = os.environ.get("GPUGO_HOST", "95.165.71.177")
PORT = int(os.environ.get("GPUGO_PORT", "42010"))
PASSWORD = os.environ["GPUGO_PASS"]

REPOS = [
    ("rgthree-comfy", "https://github.com/rgthree/rgthree-comfy.git"),
    ("ComfyUI-SeedVR2_VideoUpscaler", "https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler.git"),
    ("ComfyUI-ControlAltAI-Nodes", "https://github.com/gokayfem/ComfyUI-ControlAltAI-Nodes.git"),  # may have FluxResolution - verify
    ("was-ns", "https://github.com/WASasquatch/was-node-suite-comfyui.git"),  # ColorCorrect often here
    ("ComfyUI_essentials", "https://github.com/cubiq/ComfyUI_essentials.git"),  # already have comfyui_essentials - skip if exists
    ("cg-use-everywhere", "https://github.com/chrisgoringe/cg-use-everywhere.git"),
    ("ComfyUI-Custom-Scripts", "https://github.com/pythongosssss/ComfyUI-Custom-Scripts.git"),
    ("comfyui_memory_cleanup", "https://github.com/LAOGOU-666/Comfyui-Memory_Cleanup.git"),  # placeholder skip later
]

# Better map after research - FluxResolution from ControlAltAI-Nodes
# Lucy Sharpen - search: Derfuu or Filmesque
# Image Bloom Filter, ChromaticAberration - often from "ComfyUI-post-processing-nodes" or was-ns

EXTRA = [
    ("ComfyUI-post-processing-nodes", "https://github.com/EllangoK/ComfyUI-post-processing-nodes.git"),
    ("Derfuu_ComfyUI_ModdedNodes", "https://github.com/Derfuu/Derfuu_ComfyUI_ModdedNodes.git"),
    ("ComfyUI_LayerStyle", "https://github.com/chflame163/ComfyUI_LayerStyle.git"),  # often has bloom/sharpen
    ("ComfyUI-Impact-Pack", "https://github.com/ltdrdata/ComfyUI-Impact-Pack.git"),  # already have
]


def connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(
        HOST,
        port=PORT,
        username="root",
        password=PASSWORD,
        timeout=45,
        allow_agent=False,
        look_for_keys=False,
    )
    return c


def run(client, cmd, timeout=900):
    print(f"\n$ {cmd[:220]}...", flush=True) if len(cmd) > 220 else print(f"\n$ {cmd}", flush=True)
    stdin, stdout, stderr = client.exec_command(cmd, get_pty=True, timeout=timeout)
    while not stdout.channel.exit_status_ready():
        if stdout.channel.recv_ready():
            print(stdout.channel.recv(8192).decode(errors="replace"), end="", flush=True)
        time.sleep(0.05)
    while stdout.channel.recv_ready():
        print(stdout.channel.recv(8192).decode(errors="replace"), end="", flush=True)
    return stdout.channel.recv_exit_status()


def main():
    client = connect()
    try:
        # Install core missing packs
        script = r"""
set -e
cd /workspace/custom_nodes
clone_if_missing() {
  name="$1"; url="$2"
  if [ -d "$name" ]; then echo "EXISTS $name"; return 0; fi
  echo "CLONE $name"
  git clone --depth 1 "$url" "$name" || echo "FAIL $name"
}
clone_if_missing rgthree-comfy https://github.com/rgthree/rgthree-comfy.git
clone_if_missing ComfyUI-SeedVR2_VideoUpscaler https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler.git
clone_if_missing ControlAltAI-Nodes https://github.com/gokayfem/ComfyUI-ControlAltAI-Nodes.git
clone_if_missing was-node-suite-comfyui https://github.com/WASasquatch/was-node-suite-comfyui.git
clone_if_missing ComfyUI-post-processing-nodes https://github.com/EllangoK/ComfyUI-post-processing-nodes.git
clone_if_missing cg-use-everywhere https://github.com/chrisgoringe/cg-use-everywhere.git
clone_if_missing ComfyUI_LayerStyle https://github.com/chflame163/ComfyUI_LayerStyle.git
clone_if_missing ComfyUI-Easy-Use https://github.com/yolain/ComfyUI-Easy-Use.git
# SetNode/GetNode often from this:
clone_if_missing ComfyUI-Custom-Scripts https://github.com/pythongosssss/ComfyUI-Custom-Scripts.git
# Lucy Sharpen
clone_if_missing ComfyUI-Image-Filters https://github.com/spacepxl/ComfyUI-Image-Filters.git
# Flux resolution alternative pack
clone_if_missing comfyui-art-gallery https://github.com/gokayfem/ComfyUI-Flux-Resolution.git || true
ls -1
"""
        run(client, script, timeout=600)

        # Find FluxResolution repo if ControlAltAI wrong
        run(
            client,
            """
cd /workspace/custom_nodes
# try known ControlAltAI path
if [ ! -d ControlAltAI-Nodes ]; then
  git clone --depth 1 https://github.com/gokayfem/ComfyUI-ControlAltAI-Nodes.git ControlAltAI-Nodes || true
fi
# FluxResolution sometimes in:
git clone --depth 1 https://github.com/gokayfem/ComfyUI-Fluxor.git ComfyUI-Fluxor 2>/dev/null || true
# search locally after clones
grep -rln 'FluxResolutionNode' /workspace/custom_nodes 2>/dev/null | head
grep -rln 'Image Lucy Sharpen\\|LucySharpen\\|Lucy_Sharpen' /workspace/custom_nodes 2>/dev/null | head
grep -rln 'class SetNode\\|SetNode' /workspace/custom_nodes --include='*.py' 2>/dev/null | head
""",
            timeout=180,
        )

        # pip install requirements for seedvr and others using comfy venv if exists
        run(
            client,
            """
PY=/opt/ComfyUI/.venv/bin/pip
[ -x "$PY" ] || PY=pip3
for d in /workspace/custom_nodes/ComfyUI-SeedVR2_VideoUpscaler /workspace/custom_nodes/was-node-suite-comfyui /workspace/custom_nodes/ComfyUI_LayerStyle /workspace/custom_nodes/ComfyUI-Easy-Use; do
  if [ -f "$d/requirements.txt" ]; then
    echo "PIP $d"
    $PY install -r "$d/requirements.txt" || true
  fi
done
""",
            timeout=900,
        )

        run(client, "supervisorctl restart comfyui; sleep 20; supervisorctl status comfyui")
    finally:
        client.close()


if __name__ == "__main__":
    main()
