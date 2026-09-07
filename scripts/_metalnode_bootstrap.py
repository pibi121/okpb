#!/usr/bin/env python3
"""Inventory + download Z-Image + Wan Remix on Metalnode, upload LoRA/workflows."""
from __future__ import annotations

import os
import time
from pathlib import Path

import paramiko

HOST = "77.94.203.13"
PORT = 22024
USER = "root"
KEY = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\metalnode_id_ed25519")
LOCAL_BACKUP = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch-spike\3 августа")

COMFY = "/work/ComfyUI"
MODELS = f"{COMFY}/models"
VENV_PY = "/work/ai/venv/bin/python3"

REMOTE_INSTALL = r'''#!/usr/bin/env python3
import os, sys, time, subprocess
from pathlib import Path

MODELS = Path("/work/ComfyUI/models")
LOG = Path("/work/SETUP_DOWNLOAD.log")
STATUS = Path("/work/SETUP_STATUS.txt")

FILES = [
  # Z-Image Turbo stills
  (
    MODELS / "diffusion_models/z_image_turbo_bf16.safetensors",
    "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors",
    10_000_000_000,
  ),
  (
    MODELS / "text_encoders/qwen_3_4b.safetensors",
    "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors",
    5_000_000_000,
  ),
  (
    MODELS / "vae/ae.safetensors",
    "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors",
    100_000_000,
  ),
  # Wan Remix I2V NSFW v3
  (
    MODELS / "diffusion_models/Wan2.2_Remix_NSFW_i2v_14b_high_lighting_fp8_e4m3fn_v3.0.safetensors",
    "https://huggingface.co/FX-FeiHou/wan2.2-Remix/resolve/main/NSFW/Wan2.2_Remix_NSFW_i2v_14b_high_lighting_fp8_e4m3fn_v3.0.safetensors",
    10_000_000_000,
  ),
  (
    MODELS / "diffusion_models/Wan2.2_Remix_NSFW_i2v_14b_low_lighting_fp8_e4m3fn_v3.0.safetensors",
    "https://huggingface.co/FX-FeiHou/wan2.2-Remix/resolve/main/NSFW/Wan2.2_Remix_NSFW_i2v_14b_low_lighting_fp8_e4m3fn_v3.0.safetensors",
    10_000_000_000,
  ),
  (
    MODELS / "text_encoders/nsfw_wan_umt5-xxl_fp8_scaled.safetensors",
    "https://huggingface.co/NSFW-API/NSFW-Wan-UMT5-XXL/resolve/main/nsfw_wan_umt5-xxl_fp8_scaled.safetensors",
    5_000_000_000,
  ),
  (
    MODELS / "vae/wan_2.1_vae.safetensors",
    "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors",
    100_000_000,
  ),
]

def log(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")

def free_gb():
    st = os.statvfs("/work")
    return st.f_bavail * st.f_frsize / (1024**3)

def download(dest: Path, url: str, min_ok: int):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > min_ok:
        log(f"EXISTS {dest.name} ({dest.stat().st_size})")
        return True
    part = Path(str(dest) + ".part")
    if part.exists():
        # resume with wget -c
        pass
    log(f"DL start {dest.name} free={free_gb():.1f}G")
    # Prefer wget into .part (no HF cache 2x)
    for cmd in (
        ["wget", "-c", "-O", str(part), url],
        ["curl", "-L", "--fail", "-C", "-", "-o", str(part), url],
    ):
        r = subprocess.run(cmd)
        if r.returncode == 0 and part.exists() and part.stat().st_size > min_ok:
            part.rename(dest)
            log(f"DL done {dest.name} ({dest.stat().st_size}) free={free_gb():.1f}G")
            return True
        log(f"{cmd[0]} rc={r.returncode} size={part.stat().st_size if part.exists() else 0}")
    # HF hub fallback
    try:
        import shutil
        from huggingface_hub import hf_hub_download
        rest = url.split("huggingface.co/", 1)[1]
        repo, _, path = rest.partition("/resolve/main/")
        p = Path(hf_hub_download(repo_id=repo, filename=path))
        try:
            os.replace(str(p), str(dest))
        except OSError:
            shutil.copy2(p, dest)
            try: p.unlink()
            except Exception: pass
        if dest.exists() and dest.stat().st_size > min_ok:
            log(f"DL done hf {dest.name} ({dest.stat().st_size})")
            return True
    except Exception as e:
        log(f"hf fail: {e}")
    log(f"FAIL {dest.name}")
    return False

def main():
    os.environ.setdefault("HF_HOME", "/work/hf_cache")
    os.environ.setdefault("HF_XET_HIGH_PERFORMANCE", "1")
    Path("/work/hf_cache").mkdir(parents=True, exist_ok=True)
    try:
        import huggingface_hub  # noqa
    except ImportError:
        subprocess.run([sys.executable, "-m", "pip", "-q", "install", "-U", "huggingface_hub"], check=False)

    LOG.write_text("Metalnode setup download\n", encoding="utf-8")
    log(f"free start {free_gb():.1f}G")
    ok = True
    for dest, url, min_ok in FILES:
        if not download(Path(dest), url, min_ok):
            ok = False
    lines = [
        "READY" if ok else "PARTIAL",
        "",
        "Z-Image Turbo + Wan Remix I2V NSFW v3",
        f"Free: {free_gb():.1f} GB",
        "",
    ]
    for dest, _, _ in FILES:
        p = Path(dest)
        lines.append(("OK   " if p.exists() and p.stat().st_size > 1_000_000 else "MISS ") + p.name)
    lines += [
        "",
        "LoRA: models/loras/olh_person_zimage.safetensors (upload separately)",
        "Workflows: user/default/workflows/",
        "",
        "Still: Z-Image-ALLinONE-v2 + LoRA olh_person (~0.7-0.85)",
        "Video: Image-to-Video-Wan-2.2 with Remix high/low + nsfw_wan_umt5 CLIP",
        "Remix steps: high 0-4, low 4-8 (LightX2V baked in)",
    ]
    STATUS.write_text("\n".join(lines) + "\n", encoding="utf-8")
    log("STATUS written")
    print(STATUS.read_text())
    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main()
'''


def connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    last = None
    for i in range(12):
        try:
            c.connect(
                HOST,
                port=PORT,
                username=USER,
                pkey=pkey,
                timeout=60,
                allow_agent=False,
                look_for_keys=False,
                banner_timeout=60,
            )
            t = c.get_transport()
            if t:
                t.set_keepalive(30)
            return c
        except Exception as e:
            last = e
            print("retry", i, e, flush=True)
            time.sleep(3)
    raise SystemExit(f"ssh fail: {last}")


def run(c, cmd, timeout=120):
    _, so, se = c.exec_command(cmd, timeout=timeout)
    out = so.read().decode("utf-8", errors="replace")
    err = se.read().decode("utf-8", errors="replace")
    return out, err


def inventory(c):
    out, _ = run(
        c,
        "nvidia-smi --query-gpu=name,memory.total,memory.used --format=csv; "
        "df -h /work / | head -5; "
        "echo '---models---'; "
        "ls /work/ComfyUI/models/diffusion_models /work/ComfyUI/models/text_encoders "
        "/work/ComfyUI/models/vae /work/ComfyUI/models/loras 2>/dev/null; "
        "echo '---comfy port---'; "
        "ss -ltnp 2>/dev/null | grep -E '8188|9000|8888' || true; "
        "echo '---workflows---'; "
        "ls /work/ComfyUI/user/default/workflows 2>/dev/null | head; "
        "ls /work/bin/start-comfy.sh; head -30 /work/bin/start-comfy.sh",
    )
    print(out)


def start_download(c):
    sftp = c.open_sftp()
    with sftp.file("/tmp/metalnode_setup_dl.py", "w") as f:
        f.write(REMOTE_INSTALL)
    sftp.close()
    out, err = run(
        c,
        "pkill -f metalnode_setup_dl.py >/dev/null 2>&1 || true; "
        f"nohup {VENV_PY} -u /tmp/metalnode_setup_dl.py "
        "> /work/SETUP_DOWNLOAD.nohup 2>&1 & echo PID=$!; sleep 3; "
        "pgrep -af metalnode_setup_dl || echo NO_PROC; "
        "tail -n 20 /work/SETUP_DOWNLOAD.log 2>/dev/null || true",
        timeout=60,
    )
    print(out)
    if err.strip():
        print("STDERR", err[-500:])


def upload_assets(c):
    sftp = c.open_sftp()
    # ensure dirs
    for d in [
        f"{MODELS}/loras",
        f"{MODELS}/upscale_models",
        f"{COMFY}/user/default/workflows",
    ]:
        try:
            sftp.stat(d)
        except FileNotFoundError:
            # mkdir -p via ssh easier
            pass
    run(c, f"mkdir -p {MODELS}/loras {MODELS}/upscale_models {COMFY}/user/default/workflows")

    uploads = [
        (LOCAL_BACKUP / "olh_person_zimage.safetensors", f"{MODELS}/loras/olh_person_zimage.safetensors"),
        (LOCAL_BACKUP / "olh_person_zimage_1500.safetensors", f"{MODELS}/loras/olh_person_zimage_1500.safetensors"),
        (LOCAL_BACKUP / "olh_person_zimage_2000.safetensors", f"{MODELS}/loras/olh_person_zimage_2000.safetensors"),
        (LOCAL_BACKUP / "1xSkinContrast-High-SuperUltraCompact.pth", f"{MODELS}/upscale_models/1xSkinContrast-High-SuperUltraCompact.pth"),
        (LOCAL_BACKUP / "Z-Image-ALLinONE-v2.json", f"{COMFY}/user/default/workflows/Z-Image-ALLinONE-v2.json"),
        (LOCAL_BACKUP / "Z-Image ALLinONE v2 upd.json", f"{COMFY}/user/default/workflows/Z-Image-ALLinONE-v2-upd.json"),
        (LOCAL_BACKUP / "Image-to-Video-Wan-2.2.json", f"{COMFY}/user/default/workflows/Image-to-Video-Wan-2.2.json"),
    ]
    for src, dst in uploads:
        if not src.exists():
            print("SKIP missing", src.name)
            continue
        print(f"UPLOAD {src.name} -> {dst} ({src.stat().st_size})", flush=True)
        sftp.put(str(src), dst)
        print("  done", flush=True)
    sftp.close()


def main():
    # ensure key ACL-ish: paramiko reads fine from txt copy
    if not KEY.exists():
        src = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519.txt")
        KEY.write_bytes(src.read_bytes())
    c = connect()
    print("=== INVENTORY ===", flush=True)
    inventory(c)
    print("=== UPLOAD LORA/WORKFLOWS ===", flush=True)
    upload_assets(c)
    print("=== START MODEL DOWNLOAD ===", flush=True)
    start_download(c)
    c.close()
    print("BOOTSTRAPPED")


if __name__ == "__main__":
    main()
