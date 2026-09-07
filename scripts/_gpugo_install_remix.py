#!/usr/bin/env python3
"""Download Wan 2.2 Remix I2V NSFW v3 + NSFW CLIP onto GPUGO."""
from __future__ import annotations

import os
import time
from pathlib import Path

import paramiko

PASSWORD = os.environ.get("GPUGO_PASS") or "C5FdcIQ5"

REMOTE = r'''#!/usr/bin/env python3
import os, sys, time, subprocess
from pathlib import Path

FILES = [
  (
    "/workspace/models/diffusion_models/Wan2.2_Remix_NSFW_i2v_14b_high_lighting_fp8_e4m3fn_v3.0.safetensors",
    "https://huggingface.co/FX-FeiHou/wan2.2-Remix/resolve/main/NSFW/Wan2.2_Remix_NSFW_i2v_14b_high_lighting_fp8_e4m3fn_v3.0.safetensors",
  ),
  (
    "/workspace/models/diffusion_models/Wan2.2_Remix_NSFW_i2v_14b_low_lighting_fp8_e4m3fn_v3.0.safetensors",
    "https://huggingface.co/FX-FeiHou/wan2.2-Remix/resolve/main/NSFW/Wan2.2_Remix_NSFW_i2v_14b_low_lighting_fp8_e4m3fn_v3.0.safetensors",
  ),
  (
    "/workspace/models/text_encoders/nsfw_wan_umt5-xxl_fp8_scaled.safetensors",
    "https://huggingface.co/NSFW-API/NSFW-Wan-UMT5-XXL/resolve/main/nsfw_wan_umt5-xxl_fp8_scaled.safetensors",
  ),
]

LOG = Path("/workspace/REMIX_DOWNLOAD.log")
STATUS = Path("/workspace/REMIX_STATUS.txt")

def log(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")

def free_gb():
    st = os.statvfs("/workspace")
    return st.f_bavail * st.f_frsize / (1024**3)

def download(dest, url):
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    min_ok = 1_000_000_000 if "umt5" in dest.name.lower() or "Remix" in dest.name else 1_000_000
    if dest.exists() and dest.stat().st_size > min_ok:
        log(f"EXISTS {dest.name} ({dest.stat().st_size})")
        return True
    part = Path(str(dest) + ".part")
    if part.exists():
        part.unlink()
    log(f"DL start {dest.name} free={free_gb():.1f}G")
    # Prefer direct wget/curl into .part (no HF cache 2x disk)
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
    # HF hub fallback (move out of cache)
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
            try:
                p.unlink()
            except Exception:
                pass
        if dest.exists() and dest.stat().st_size > min_ok:
            log(f"DL done hf {dest.name} ({dest.stat().st_size})")
            return True
    except Exception as e:
        log(f"hf fail: {e}")
    log(f"FAIL {dest.name}")
    if part.exists():
        part.unlink()
    return False

def main():
    os.environ.setdefault("HF_HOME", "/workspace/hf_cache")
    os.environ.setdefault("HF_XET_HIGH_PERFORMANCE", "1")
    Path("/workspace/hf_cache").mkdir(parents=True, exist_ok=True)
    try:
        import huggingface_hub  # noqa
    except ImportError:
        subprocess.run([sys.executable, "-m", "pip", "-q", "install", "-U", "huggingface_hub"], check=False)

    LOG.write_text("Remix download start\n", encoding="utf-8")
    log(f"free start {free_gb():.1f}G")
    if free_gb() < 36:
        # free stock Wan temporarily? prefer keep — try delete lightx2v first if needed
        for p in [
            Path("/workspace/models/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors"),
            Path("/workspace/models/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors"),
        ]:
            if p.exists() and free_gb() < 36:
                sz = p.stat().st_size / (1024**3)
                p.unlink()
                log(f"deleted {p.name} ({sz:.1f}G) for space")
    ok = True
    for dest, url in FILES:
        if not download(dest, url):
            ok = False
    lines = [
        "Wan 2.2 Remix I2V NSFW v3 READY" if ok else "Wan 2.2 Remix PARTIAL",
        "",
    ]
    for dest, _ in FILES:
        p = Path(dest)
        lines.append(("OK   " if p.exists() and p.stat().st_size > 1_000_000 else "MISS ") + p.name)
    lines += [
        "",
        "VAE: wan_2.1_vae.safetensors (already present)",
        "Stock Wan I2V high/low kept for A/B if still on disk.",
        "",
        "In Remix workflow pick:",
        "  high: Wan2.2_Remix_NSFW_i2v_14b_high_lighting_fp8_e4m3fn_v3.0.safetensors",
        "  low:  Wan2.2_Remix_NSFW_i2v_14b_low_lighting_fp8_e4m3fn_v3.0.safetensors",
        "  CLIP: nsfw_wan_umt5-xxl_fp8_scaled.safetensors",
        f"Free: {free_gb():.1f} GB",
        "Freed earlier: ultrarealFineTune_v4, t5xxl_fp16, clip_l, z_image_bf16 (Turbo kept).",
    ]
    STATUS.write_text("\n".join(lines) + "\n", encoding="utf-8")
    log("STATUS written")
    print(STATUS.read_text(encoding="utf-8"))
    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main()
'''


def connect(retries=12):
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
            t = c.get_transport()
            if t:
                t.set_keepalive(30)
            return c
        except Exception as e:
            last = e
            print("retry", i, e, flush=True)
            time.sleep(4)
    raise SystemExit(f"ssh fail: {last}")


def main():
    c = connect()
    sftp = c.open_sftp()
    with sftp.file("/tmp/install_remix.py", "w") as f:
        f.write(REMOTE)
    sftp.close()

    _, stdout, stderr = c.exec_command(
        "pkill -f '/tmp/install_remix.py' >/dev/null 2>&1 || true; "
        "nohup /opt/ComfyUI/.venv/bin/python -u /tmp/install_remix.py "
        "> /workspace/REMIX_DOWNLOAD.nohup 2>&1 & echo PID=$!; sleep 3; "
        "pgrep -af install_remix | head -5; "
        "tail -n 15 /workspace/REMIX_DOWNLOAD.log 2>/dev/null || true",
        timeout=90,
    )
    print(stdout.read().decode("utf-8", errors="replace"))
    err = stderr.read().decode("utf-8", errors="replace")
    if err:
        print("ERR", err[-500:])
    c.close()
    print("DOWNLOAD_STARTED")


if __name__ == "__main__":
    main()
