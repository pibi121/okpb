#!/usr/bin/env python3
"""Download Wan 2.2 I2V models for existing Comfy blueprint; copy workflow; write status."""
from __future__ import annotations

import os
import time
from pathlib import Path

import paramiko

PASSWORD = os.environ.get("GPUGO_PASS") or "C5FdcIQ5"
OUT = Path(__file__).with_name("_wan_dl_out.txt")

REMOTE_HELPER = r'''#!/usr/bin/env python3
import os, sys, time, subprocess
from pathlib import Path

FILES = [
  (
    "/workspace/models/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors",
    "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors",
  ),
  (
    "/workspace/models/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
    "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
  ),
  (
    "/workspace/models/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors",
    "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors",
  ),
  (
    "/workspace/models/vae/wan_2.1_vae.safetensors",
    "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors",
  ),
  (
    "/workspace/models/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors",
    "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors",
  ),
  (
    "/workspace/models/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors",
    "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors",
  ),
]

LOG = Path("/workspace/WAN_I2V_DOWNLOAD.log")
STATUS = Path("/workspace/WAN_I2V_STATUS.txt")

def log(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")

def download(dest, url):
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 1_000_000:
        log(f"EXISTS {dest} ({dest.stat().st_size})")
        return True
    part = Path(str(dest) + ".part")
    if part.exists():
        part.unlink()
    log(f"DL start {dest.name}")
    # prefer hf_hub if available
    try:
        import shutil
        from huggingface_hub import hf_hub_download
        # https://huggingface.co/{repo}/resolve/main/{path}
        rest = url.split("huggingface.co/", 1)[1]
        repo, _, path = rest.partition("/resolve/main/")
        p = Path(hf_hub_download(repo_id=repo, filename=path))
        shutil.copy2(p, dest)
        log(f"DL done hf {dest} ({dest.stat().st_size})")
        return True
    except Exception as e:
        log(f"hf failed ({e}), trying wget")
    cmd = ["wget", "-O", str(part), url]
    r = subprocess.run(cmd)
    if r.returncode != 0:
        cmd = ["curl", "-L", "--fail", "-o", str(part), url]
        r = subprocess.run(cmd)
    if r.returncode != 0 or not part.exists() or part.stat().st_size < 1000:
        log(f"FAIL {dest.name}")
        return False
    part.rename(dest)
    log(f"DL done wget {dest} ({dest.stat().st_size})")
    return True

def main():
    os.environ.setdefault("HF_HOME", "/workspace/hf_cache")
    os.environ.setdefault("HF_XET_HIGH_PERFORMANCE", "1")
    Path("/workspace/hf_cache").mkdir(parents=True, exist_ok=True)
    try:
        import huggingface_hub  # noqa: F401
    except ImportError:
        subprocess.run([sys.executable, "-m", "pip", "-q", "install", "-U", "huggingface_hub"], check=False)
    LOG.write_text("Wan I2V download start\n", encoding="utf-8")
    ok = True
    for dest, url in FILES:
        if not download(dest, url):
            ok = False
    # copy blueprint into workflows for easy open
    import shutil
    src = Path("/opt/ComfyUI/blueprints/Image to Video (Wan 2.2).json")
    for dst in [
        Path("/workspace/user/default/workflows/Image-to-Video-Wan-2.2.json"),
        Path("/workspace/user/default/workflows/Wan-I2V-2.2.json"),
    ]:
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        log(f"workflow -> {dst}")

    missing = []
    for dest, _ in FILES:
        p = Path(dest)
        if not p.exists() or p.stat().st_size < 1000:
            missing.append(dest)
    STATUS.write_text(
        ("Wan 2.2 I2V READY\n" if not missing else "Wan 2.2 I2V PARTIAL\n")
        + "\n".join(f"OK {d}" if Path(d).exists() else f"MISS {d}" for d,_ in FILES)
        + "\n\nOpen in Comfy: Workflow -> Image-to-Video-Wan-2.2 (or Templates Wan 2.2)\n"
        + "1. Load Image = still from Z-Image+LoRA\n"
        + "2. Prompt motion (english)\n"
        + "3. Queue (first run may be slow)\n"
        + "LightX2V 4-step LoRAs included for faster gens.\n",
        encoding="utf-8",
    )
    log("STATUS written")
    print(STATUS.read_text(encoding="utf-8"))
    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main()
'''


def connect(retries=8):
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    last = None
    for i in range(retries):
        try:
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
        except Exception as e:
            last = e
            print("retry", i, e, flush=True)
            time.sleep(4)
    raise SystemExit(f"ssh fail: {last}")


def main():
    OUT.write_text("start\n", encoding="utf-8")
    c = connect()
    sftp = c.open_sftp()
    with sftp.file("/tmp/wan_i2v_download.py", "w") as f:
        f.write(REMOTE_HELPER)
    sftp.close()

    # run in background via nohup so SSH drop won't kill multi-GB downloads
    _, stdout, stderr = c.exec_command(
        "pkill -f wan_i2v_download.py >/dev/null 2>&1 || true; "
        "nohup /opt/ComfyUI/.venv/bin/python -u /tmp/wan_i2v_download.py "
        "> /workspace/WAN_I2V_DOWNLOAD.nohup 2>&1 & echo PID=$!; sleep 2; "
        "ps aux | grep wan_i2v_download | grep -v grep | head",
        timeout=60,
    )
    print(stdout.read().decode("utf-8", errors="replace"))
    print(stderr.read().decode("utf-8", errors="replace")[-500:])
    c.close()
    print("DOWNLOAD_STARTED")


if __name__ == "__main__":
    main()
