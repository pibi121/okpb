#!/usr/bin/env python3
"""Monitor Remix download; if stuck/failing on disk, restart with move-not-copy."""
from __future__ import annotations

import os
import time
from pathlib import Path

import paramiko

PASSWORD = os.environ.get("GPUGO_PASS") or "C5FdcIQ5"

REMOTE_FIX = r'''#!/usr/bin/env python3
import os, sys, time, shutil, subprocess
from pathlib import Path

os.environ.setdefault("HF_HOME", "/workspace/hf_cache")
os.environ.setdefault("HF_XET_HIGH_PERFORMANCE", "1")
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

def download_move(dest, repo, filename):
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 10_000_000_000:
        log(f"EXISTS {dest.name} ({dest.stat().st_size})")
        return True
    # remove partial
    if dest.exists():
        dest.unlink()
    log(f"DL start {dest.name} free={free_gb():.1f}G")
    from huggingface_hub import hf_hub_download
    p = Path(hf_hub_download(repo_id=repo, filename=filename))
    log(f"hub path {p} size={p.stat().st_size}")
    # MOVE into models to avoid 2x disk
    try:
        shutil.move(str(p), str(dest))
    except Exception:
        shutil.copy2(p, dest)
        try:
            p.unlink()
        except Exception:
            pass
    log(f"DL done {dest.name} ({dest.stat().st_size}) free={free_gb():.1f}G")
    return True

FILES = [
    (
        "/workspace/models/diffusion_models/Wan2.2_Remix_NSFW_i2v_14b_high_lighting_fp8_e4m3fn_v3.0.safetensors",
        "FX-FeiHou/wan2.2-Remix",
        "NSFW/Wan2.2_Remix_NSFW_i2v_14b_high_lighting_fp8_e4m3fn_v3.0.safetensors",
    ),
    (
        "/workspace/models/diffusion_models/Wan2.2_Remix_NSFW_i2v_14b_low_lighting_fp8_e4m3fn_v3.0.safetensors",
        "FX-FeiHou/wan2.2-Remix",
        "NSFW/Wan2.2_Remix_NSFW_i2v_14b_low_lighting_fp8_e4m3fn_v3.0.safetensors",
    ),
]

def find_clip():
    from huggingface_hub import list_repo_files, hf_hub_download
    dest = Path("/workspace/models/text_encoders/nsfw_wan_umt5-xxl_fp8_scaled.safetensors")
    if dest.exists() and dest.stat().st_size > 1_000_000_000:
        log(f"EXISTS CLIP {dest.name}")
        return True
    repos = ["NSFW-API/NSFW-Wan-UMT5-XXL", "v3gg13/NSFW-Wan-UMT5-XXL", "FX-FeiHou/wan2.2-Remix"]
    for repo in repos:
        try:
            files = list_repo_files(repo)
        except Exception as e:
            log(f"list {repo}: {e}")
            continue
        hits = [f for f in files if f.endswith(".safetensors") and "umt5" in f.lower()]
        log(f"{repo} hits {hits[:10]}")
        for f in hits:
            if "fp8" in f.lower() or True:
                try:
                    p = Path(hf_hub_download(repo_id=repo, filename=f))
                    try:
                        shutil.move(str(p), str(dest))
                    except Exception:
                        shutil.copy2(p, dest)
                        try: p.unlink()
                        except Exception: pass
                    log(f"CLIP OK from {repo}/{f} ({dest.stat().st_size})")
                    return True
                except Exception as e:
                    log(f"clip fail {f}: {e}")
    log("CLIP NSFW missing — use umt5_xxl_fp8_e4m3fn_scaled.safetensors")
    return False

def main():
    # if another installer running with same files, wait? we kill externally
    ok = True
    for dest, repo, fn in FILES:
        try:
            if not download_move(dest, repo, fn):
                ok = False
        except Exception as e:
            log(f"FAIL {dest}: {e}")
            ok = False
    clip_ok = find_clip()
    lines = [
        "Wan 2.2 Remix I2V NSFW v3 READY" if ok else "Wan 2.2 Remix PARTIAL",
    ]
    for dest, _, _ in FILES:
        p = Path(dest)
        lines.append(("OK " if p.exists() else "MISS ") + p.name)
    lines.append("CLIP NSFW: " + ("OK nsfw_wan_umt5-xxl_fp8_scaled.safetensors" if clip_ok else "fallback umt5_xxl_fp8_e4m3fn_scaled.safetensors"))
    lines.append("VAE: wan_2.1_vae.safetensors")
    lines.append("")
    lines.append("В workflow Remix выбери:")
    lines.append("  high noise: Wan2.2_Remix_NSFW_i2v_14b_high_lighting_fp8_e4m3fn_v3.0.safetensors")
    lines.append("  low noise:  Wan2.2_Remix_NSFW_i2v_14b_low_lighting_fp8_e4m3fn_v3.0.safetensors")
    lines.append("Stock Wan 2.2 I2V оставлен для A/B.")
    lines.append(f"Free: {free_gb():.1f} GB")
    lines.append("Удалено ради места: ultrarealFineTune_v4, t5xxl_fp16, clip_l, z_image_bf16 (Turbo остался).")
    STATUS.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(STATUS.read_text())
    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main()
'''


def connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    for i in range(12):
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
            print("retry", i, e, flush=True)
            time.sleep(3)
    raise SystemExit("ssh fail")


def main():
    c = connect()
    # status of current download
    _, stdout, _ = c.exec_command(
        "python3 - <<'PY'\n"
        "from pathlib import Path\n"
        "import subprocess, os\n"
        "st=os.statvfs('/workspace')\n"
        "free=st.f_bavail*st.f_frsize/(1024**3)\n"
        "print(f'FREE {free:.1f}G')\n"
        "r=subprocess.run(['pgrep','-af','install_remix|hf_hub|huggingface'],capture_output=True,text=True)\n"
        "print('PROCS', (r.stdout or '')[:800])\n"
        "dd=Path('/workspace/models/diffusion_models')\n"
        "for p in sorted(dd.glob('*Remix*'))+sorted(dd.glob('*.partial')):\n"
        " print(p.name, p.stat().st_size)\n"
        "log=Path('/workspace/REMIX_DOWNLOAD.log')\n"
        "print('LOGTAIL')\n"
        "print(log.read_text(errors='replace')[-1500:] if log.exists() else 'none')\n"
        "PY",
        timeout=60,
    )
    print(stdout.read().decode("utf-8", errors="replace"))

    # Kill old installer (uses copy2 = disk risk) and restart with move
    print("Restarting with move-based install...", flush=True)
    c.exec_command("pkill -f '/tmp/install_remix.py' || true; pkill -f 'huggingface_hub' || true")
    time.sleep(2)

    sftp = c.open_sftp()
    with sftp.file("/tmp/install_remix.py", "w") as f:
        f.write(REMOTE_FIX)
    sftp.close()

    transport = c.get_transport()
    ch = transport.open_session()
    ch.exec_command(
        "setsid /opt/ComfyUI/.venv/bin/python -u /tmp/install_remix.py "
        "> /workspace/REMIX_DOWNLOAD.nohup 2>&1 < /dev/null"
    )
    time.sleep(3)
    ch.close()
    time.sleep(5)

    _, stdout, _ = c.exec_command(
        "tail -n 40 /workspace/REMIX_DOWNLOAD.log; echo ---; pgrep -af install_remix || true",
        timeout=30,
    )
    print(stdout.read().decode("utf-8", errors="replace"))
    c.close()


if __name__ == "__main__":
    main()
