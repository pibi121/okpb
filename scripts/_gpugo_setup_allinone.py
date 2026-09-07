#!/usr/bin/env python3
"""Setup Z-Image All-in-One on remote GPUGO."""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

import paramiko

HOST = os.environ.get("GPUGO_HOST", "95.165.71.177")
PORT = int(os.environ.get("GPUGO_PORT", "42010"))
USER = os.environ.get("GPUGO_USER", "root")
PASSWORD = os.environ["GPUGO_PASS"]

LOCAL_JSON = Path(r"c:\Users\Олег\Downloads\Telegram Desktop\Z-Image ALLinONE v2 upd.json")
REMOTE_WF = "/workspace/user/default/workflows/Z-Image-ALLinONE-v2.json"
REMOTE_BP = "/opt/ComfyUI/blueprints/Z-Image-ALLinONE-v2.json"


def connect() -> paramiko.SSHClient:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    for i in range(5):
        try:
            c.connect(
                HOST,
                port=PORT,
                username=USER,
                password=PASSWORD,
                timeout=45,
                allow_agent=False,
                look_for_keys=False,
            )
            return c
        except Exception as e:
            print(f"connect retry {i}: {e}")
            time.sleep(2)
    raise SystemExit("SSH failed")


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 600) -> tuple[int, str]:
    print(f"\n$ {cmd[:200]}{'...' if len(cmd) > 200 else ''}", flush=True)
    stdin, stdout, stderr = client.exec_command(cmd, get_pty=True, timeout=timeout)
    chunks: list[str] = []
    while not stdout.channel.exit_status_ready():
        if stdout.channel.recv_ready():
            chunk = stdout.channel.recv(8192).decode(errors="replace")
            chunks.append(chunk)
            print(chunk, end="", flush=True)
        time.sleep(0.05)
    while stdout.channel.recv_ready():
        chunk = stdout.channel.recv(8192).decode(errors="replace")
        chunks.append(chunk)
        print(chunk, end="", flush=True)
    code = stdout.channel.recv_exit_status()
    print(f"\n[exit {code}]", flush=True)
    return code, "".join(chunks)


def main() -> None:
    if not LOCAL_JSON.exists():
        raise SystemExit(f"missing {LOCAL_JSON}")

    # Patch workflow: use local bf16 turbo + ae if possible
    data = json.loads(LOCAL_JSON.read_text(encoding="utf-8"))
    for node in data.get("nodes", []):
        w = node.get("widgets_values")
        if not isinstance(w, list):
            continue
        # UNET
        if node.get("type") == "UNETLoader" and w and isinstance(w[0], str) and "z-image" in w[0].lower():
            w[0] = "z_image_turbo_bf16.safetensors"
            if len(w) > 1:
                w[1] = "default"
            print("patched UNET -> z_image_turbo_bf16")
        # VAE - keep ultraflux if we download it; also note ae fallback
        if node.get("type") == "VAELoader" and w and isinstance(w[0], str):
            print(f"VAE in workflow: {w[0]}")
        if node.get("type") == "CLIPLoader" and w and isinstance(w[0], str):
            print(f"CLIP in workflow: {w}")

    patched = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\scripts\_zimage_allinone_patched.json")
    patched.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    client = connect()
    try:
        sftp = client.open_sftp()
        run(client, "mkdir -p /workspace/user/default/workflows /opt/ComfyUI/blueprints /workspace/models/loras/Zimage /workspace/logs")
        print("Uploading workflow...")
        sftp.put(str(patched), REMOTE_WF)
        sftp.put(str(patched), REMOTE_BP)
        sftp.put(str(patched), "/workspace/user/default/workflows/Z-Image ALLinONE v2.json")
        sftp.close()

        run(client, "ls -lh /workspace/user/default/workflows/ | grep -i allin; ls /workspace/custom_nodes")

        # List installed vs needed node types via a small remote python hitting object_info
        run(
            client,
            """python3 << 'PY'
import json, urllib.request
needed = [
  "FaceDetailer", "UltralyticsDetectorProvider", "SAMLoader",
  "Power Lora Loader (rgthree)", "Lora Loader Stack (rgthree)",
  "SeedVR2VideoUpscaler", "SeedVR2LoadDiTModel", "FluxResolutionNode",
  "Image Lucy Sharpen", "ColorCorrect", "ChromaticAberration",
  "Image Bloom Filter", "Image Comparer (rgthree)", "SetNode", "GetNode",
  "ImageResize+", "Fast Groups Bypasser (rgthree)"
]
try:
  with urllib.request.urlopen("http://127.0.0.1:9000/object_info", timeout=60) as r:
    d = json.load(r)
except Exception as e:
  print("object_info fail", e)
  raise SystemExit(1)
missing = [n for n in needed if n not in d]
print("HAVE", len(d), "nodes")
print("MISSING", missing)
print("HAS FaceDetailer", "FaceDetailer" in d)
print("HAS SeedVR", "SeedVR2VideoUpscaler" in d)
print("HAS rgthree Power", "Power Lora Loader (rgthree)" in d)
print("HAS FluxResolution", "FluxResolutionNode" in d)
print("HAS SetNode", "SetNode" in d)
PY""",
            timeout=120,
        )
    finally:
        client.close()


if __name__ == "__main__":
    main()
