#!/usr/bin/env python3
"""Finish remaining Metalnode downloads: NSFW CLIP + wan VAE (IPv4)."""
from pathlib import Path
import paramiko
import time

KEY = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\metalnode_id_ed25519")

REMOTE = r'''#!/usr/bin/env python3
import os, time, subprocess
from pathlib import Path

LOG = Path("/work/SETUP_DOWNLOAD.log")
STATUS = Path("/work/SETUP_STATUS.txt")

FILES = [
  (
    Path("/work/ComfyUI/models/text_encoders/nsfw_wan_umt5-xxl_fp8_scaled.safetensors"),
    "https://huggingface.co/NSFW-API/NSFW-Wan-UMT5-XXL/resolve/main/nsfw_wan_umt5-xxl_fp8_scaled.safetensors",
    5_000_000_000,
  ),
  (
    Path("/work/ComfyUI/models/vae/wan_2.1_vae.safetensors"),
    "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors",
    100_000_000,
  ),
  # fallback stock CLIP if NSFW fails later — also useful
  (
    Path("/work/ComfyUI/models/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors"),
    "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors",
    5_000_000_000,
  ),
]

def log(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")

def download(dest, url, min_ok):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > min_ok:
        log(f"EXISTS {dest.name}")
        return True
    part = Path(str(dest) + ".part")
    if part.exists() and part.stat().st_size < 1000:
        part.unlink()
    log(f"DL start {dest.name}")
    for attempt in range(5):
        r = subprocess.run(["wget", "-4", "-c", "-O", str(part), url])
        if r.returncode == 0 and part.exists() and part.stat().st_size > min_ok:
            part.rename(dest)
            log(f"DL done {dest.name} ({dest.stat().st_size})")
            return True
        log(f"wget attempt {attempt+1} rc={r.returncode} size={part.stat().st_size if part.exists() else 0}")
        time.sleep(3)
    log(f"FAIL {dest.name}")
    return False

def main():
    ok = True
    for dest, url, min_ok in FILES:
        if not download(dest, url, min_ok):
            ok = False
    checks = [
        Path("/work/ComfyUI/models/diffusion_models/z_image_turbo_bf16.safetensors"),
        Path("/work/ComfyUI/models/text_encoders/qwen_3_4b.safetensors"),
        Path("/work/ComfyUI/models/vae/ae.safetensors"),
        Path("/work/ComfyUI/models/diffusion_models/Wan2.2_Remix_NSFW_i2v_14b_high_lighting_fp8_e4m3fn_v3.0.safetensors"),
        Path("/work/ComfyUI/models/diffusion_models/Wan2.2_Remix_NSFW_i2v_14b_low_lighting_fp8_e4m3fn_v3.0.safetensors"),
        Path("/work/ComfyUI/models/text_encoders/nsfw_wan_umt5-xxl_fp8_scaled.safetensors"),
        Path("/work/ComfyUI/models/vae/wan_2.1_vae.safetensors"),
        Path("/work/ComfyUI/models/loras/olh_person_zimage.safetensors"),
    ]
    lines = ["READY" if all(p.exists() and p.stat().st_size > 1_000_000 for p in checks[:7]) else "PARTIAL", ""]
    for p in checks:
        lines.append(("OK   " if p.exists() and p.stat().st_size > 1_000_000 else "MISS ") + p.name)
    lines += [
        "",
        "SSH: ssh -i metalnode_id_ed25519 -L 8188:localhost:8188 root@77.94.203.13 -p 22024",
        "UI: http://127.0.0.1:8188",
        "Still: Text to Image (Z-Image-Turbo) + LoRA olh_person_zimage",
        "Video: Image to Video (Wan 2.2) + Remix high/low + nsfw CLIP, steps 4+4",
    ]
    STATUS.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(STATUS.read_text())
    raise SystemExit(0 if ok else 1)

if __name__ == "__main__":
    main()
'''

def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c.connect("77.94.203.13", port=22024, username="root", pkey=pkey, timeout=60, allow_agent=False, look_for_keys=False)
    c.get_transport().set_keepalive(20)
    sftp = c.open_sftp()
    with sftp.file("/tmp/metalnode_finish_dl.py", "w") as f:
        f.write(REMOTE)
    sftp.close()
    stdin, stdout, stderr = c.exec_command(
        "rm -f /work/ComfyUI/models/text_encoders/*.part /work/ComfyUI/models/vae/wan_2.1_vae.safetensors.part; "
        "nohup /work/ai/venv/bin/python3 -u /tmp/metalnode_finish_dl.py >/work/SETUP_FINISH.nohup 2>&1 & sleep 4; "
        "pgrep -af metalnode_finish; tail -n 20 /work/SETUP_DOWNLOAD.log; head -n 15 /work/SETUP_FINISH.nohup",
        get_pty=True,
        timeout=60,
    )
    print(stdout.read().decode(errors="replace"))
    c.close()

if __name__ == "__main__":
    main()
