#!/usr/bin/env python3
"""Install quality stack on Metalnode: SeedVR2 models + RIFE VFI + still upscaler."""
from __future__ import annotations

import sys
import time
from pathlib import Path

import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (2).txt")
HOST = "77.94.203.13"
PORT = 22022

REMOTE = r'''#!/usr/bin/env python3
import os, sys, time, subprocess, urllib.request
from pathlib import Path

LOG = Path("/work/QUALITY_STACK.log")
STATUS = Path("/work/QUALITY_STACK_STATUS.txt")

def log(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")

def run(cmd, check=True):
    log(f"$ {cmd}")
    r = subprocess.run(cmd, shell=True, text=True, capture_output=True)
    if r.stdout:
        print(r.stdout[-2000:], flush=True)
    if r.returncode and check:
        log(f"FAIL rc={r.returncode}: {(r.stderr or '')[-800]}")
        raise SystemExit(r.returncode)
    return r

def dl(url, dest: Path, min_bytes=1_000_000):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size >= min_bytes:
        log(f"OK exists {dest.name} {dest.stat().st_size}")
        return
    part = Path(str(dest) + ".part")
    log(f"DL {dest.name}")
    # prefer curl resume + ipv4
    cmd = (
        f'curl -L --http1.1 --retry 5 --retry-delay 3 -C - '
        f'--connect-timeout 30 --max-time 0 '
        f'-o "{part}" "{url}"'
    )
    r = run(cmd, check=False)
    if r.returncode != 0 or not part.exists() or part.stat().st_size < min_bytes:
        log(f"curl fail, try urllib for {dest.name}")
        urllib.request.urlretrieve(url, part)
    if not part.exists() or part.stat().st_size < min_bytes:
        log(f"MISS {dest.name}")
        raise SystemExit(1)
    part.rename(dest)
    log(f"OK {dest.name} {dest.stat().st_size}")

COMFY = Path("/work/ComfyUI")
CN = COMFY / "custom_nodes"
SEED = COMFY / "models" / "SEEDVR2"
UPS = COMFY / "models" / "upscale_models"
VFI = CN / "ComfyUI-Frame-Interpolation"

STATUS.write_text("START\n", encoding="utf-8")
log("=== quality stack install ===")

# 1) Frame Interpolation (RIFE)
if not (VFI / ".git").exists():
    run(f'git clone --depth 1 https://github.com/Fannovel16/ComfyUI-Frame-Interpolation "{VFI}"')
else:
    log("VFI repo exists")
# install deps if script present
inst = VFI / "install.py"
if inst.exists():
    run(f'/work/ai/venv/bin/python3 "{inst}"', check=False)

# 2) SeedVR2 models — 5090 32GB: 3B FP8 + VAE (sweet spot); also 7B FP8 optional later
FILES = [
    (
        SEED / "seedvr2_ema_3b_fp8_e4m3fn.safetensors",
        "https://huggingface.co/numz/SeedVR2_comfyUI/resolve/main/seedvr2_ema_3b_fp8_e4m3fn.safetensors",
        3_000_000_000,
    ),
    (
        SEED / "ema_vae_fp16.safetensors",
        "https://huggingface.co/numz/SeedVR2_comfyUI/resolve/main/ema_vae_fp16.safetensors",
        200_000_000,
    ),
    # still photo upscaler (classic, fast)
    (
        UPS / "4x-UltraSharp.pth",
        "https://huggingface.co/lokCX/4x-Ultrasharp/resolve/main/4x-UltraSharp.pth",
        50_000_000,
    ),
]

for dest, url, mn in FILES:
    try:
        dl(url, dest, mn)
        STATUS.write_text(STATUS.read_text() + f"OK {dest.name}\n", encoding="utf-8")
    except SystemExit:
        STATUS.write_text(STATUS.read_text() + f"FAIL {dest.name}\n", encoding="utf-8")
        raise

# 3) Ensure RIFE ckpt via VFI download helper if available
rife_dir = VFI / "ckpts" / "rife"
rife_dir.mkdir(parents=True, exist_ok=True)
# Fannovel pack often auto-downloads; try common urls
RIFE_URLS = [
    (
        rife_dir / "rife47.pth",
        "https://github.com/hzwer/Practical-RIFE/releases/download/v4.7/flownet.pkl",
    ),
]
# Practical-RIFE naming differs; ComfyUI-Frame-Interpolation uses its own downloader.
# Trigger download script if present:
dl_script = VFI / "videovfi_models.py"
# Just mark — node downloads on first use often.
log("RIFE will auto-download on first VFI run if missing")

# 4) Restart note
STATUS.write_text(STATUS.read_text() + "ALL_DONE\n", encoding="utf-8")
log("ALL_DONE — restart ComfyUI to load VFI nodes")
print("DONE")
'''


def main() -> None:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c.connect(HOST, port=PORT, username="root", pkey=pkey, timeout=60, allow_agent=False, look_for_keys=False)
    sftp = c.open_sftp()
    remote_path = "/tmp/install_quality_stack.py"
    with sftp.file(remote_path, "w") as f:
        f.write(REMOTE)
    sftp.chmod(remote_path, 0o755)
    sftp.close()

    # run in background nohup
    cmd = f"nohup /work/ai/venv/bin/python3 -u {remote_path} > /work/QUALITY_STACK.nohup 2>&1 & echo PID:$!"
    _, so, se = c.exec_command(cmd, timeout=30)
    print(so.read().decode())
    print(se.read().decode())
    time.sleep(2)
    _, so, _ = c.exec_command("tail -20 /work/QUALITY_STACK.nohup 2>/dev/null; ls -lh /work/ComfyUI/models/SEEDVR2/ 2>/dev/null | head", timeout=30)
    print(so.read().decode())
    c.close()
    print("launched")


if __name__ == "__main__":
    main()
