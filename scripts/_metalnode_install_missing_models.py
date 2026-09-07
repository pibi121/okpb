#!/usr/bin/env python3
"""Download/remap missing All-in-One models on Metalnode."""
from pathlib import Path
import paramiko
import time
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\metalnode_id_ed25519")

REMOTE = r'''#!/usr/bin/env python3
import os, time, subprocess
from pathlib import Path

MODELS = Path("/work/ComfyUI/models")
LOG = Path("/work/INSTALL_MISSING_MODELS.log")
STATUS = Path("/work/INSTALL_MISSING_MODELS_STATUS.txt")

# (dest, url, min_bytes) — None url = symlink/copy only
FILES = [
  (
    MODELS / "sams/sam_vit_b_01ec64.pth",
    "https://huggingface.co/fofr/comfyui/resolve/main/sams/sam_vit_b_01ec64.pth",
    300_000_000,
  ),
  (
    MODELS / "ultralytics/bbox/nipples_yolov8s.pt",
    "https://huggingface.co/gazsuv/pussydetectorv4/resolve/main/nipples_yolov8s.pt",
    10_000_000,
  ),
  (
    MODELS / "ultralytics/bbox/pussyV2.pt",
    "https://huggingface.co/Dhivimhotep/adetailer/resolve/main/pussyV2.pt",
    3_000_000,
  ),
  (
    MODELS / "loras/Detailed_nipples_xl.safetensors",
    "https://huggingface.co/datasets/JuDrus/Lora_other/resolve/eb5b33a301c93a97d879d782e3d5934fadeb16b9/Detailed_nipples_xl.safetensors",
    100_000_000,
  ),
  (
    MODELS / "diffusion_models/z-image-turbo-fp8-e4m3fn.safetensors",
    "https://huggingface.co/T5B/Z-Image-Turbo-FP8/resolve/main/z-image-turbo-fp8-e4m3fn.safetensors",
    5_000_000_000,
  ),
]

def log(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")

def ensure_dirs():
    for d in [
        MODELS / "sams",
        MODELS / "ultralytics/bbox",
        MODELS / "ultralytics/segm",
        MODELS / "loras",
        MODELS / "diffusion_models",
        MODELS / "vae",
    ]:
        d.mkdir(parents=True, exist_ok=True)

def symlink_vae():
    dest = MODELS / "vae/ultrafluxVAEImproved_v10.safetensors"
    src = MODELS / "vae/ae.safetensors"
    if dest.exists() and dest.stat().st_size > 100_000_000:
        log(f"EXISTS VAE alias {dest.name}")
        return True
    if not src.exists():
        log("MISS ae.safetensors for VAE alias")
        return False
    if dest.is_symlink() or dest.exists():
        dest.unlink()
    os.symlink(str(src), str(dest))
    log(f"SYMLINK {dest.name} -> ae.safetensors")
    return True

def download(dest: Path, url: str, min_ok: int):
    if dest.exists() and dest.stat().st_size > min_ok:
        log(f"EXISTS {dest.name} ({dest.stat().st_size})")
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
        log(f"wget try {attempt+1} rc={r.returncode} size={part.stat().st_size if part.exists() else 0}")
        time.sleep(2)
    # fallback: for FP8, alias bf16 if present
    if "z-image-turbo-fp8" in dest.name:
        bf16 = MODELS / "diffusion_models/z_image_turbo_bf16.safetensors"
        if bf16.exists():
            if dest.exists() or dest.is_symlink():
                dest.unlink()
            os.symlink(str(bf16), str(dest))
            log(f"FALLBACK symlink fp8 name -> bf16 ({bf16.stat().st_size})")
            return True
    log(f"FAIL {dest.name}")
    return False

def whitelist_yolo():
    # PyTorch 2.6+ weights_only blocks old YOLO pickles
    paths = [
        Path("/work/ComfyUI/user/default/ComfyUI-Impact-Subpack/model-whitelist.txt"),
        Path("/work/ComfyUI/custom_nodes/ComfyUI-Impact-Subpack/model-whitelist.txt"),
    ]
    names = ["pussyV2.pt", "nipples_yolov8s.pt", "bbox/pussyV2.pt", "bbox/nipples_yolov8s.pt"]
    for p in paths:
        p.parent.mkdir(parents=True, exist_ok=True)
        existing = set()
        if p.exists():
            existing = {ln.strip() for ln in p.read_text(encoding="utf-8", errors="replace").splitlines() if ln.strip()}
        for n in names:
            existing.add(n)
        p.write_text("\n".join(sorted(existing)) + "\n", encoding="utf-8")
        log(f"whitelist -> {p}")

def main():
    LOG.write_text("missing models install\n", encoding="utf-8")
    ensure_dirs()
    ok = symlink_vae()
    for dest, url, min_ok in FILES:
        if not download(dest, url, min_ok):
            ok = False
    whitelist_yolo()
    checks = [
        MODELS / "diffusion_models/z-image-turbo-fp8-e4m3fn.safetensors",
        MODELS / "vae/ultrafluxVAEImproved_v10.safetensors",
        MODELS / "sams/sam_vit_b_01ec64.pth",
        MODELS / "ultralytics/bbox/pussyV2.pt",
        MODELS / "ultralytics/bbox/nipples_yolov8s.pt",
        MODELS / "loras/Detailed_nipples_xl.safetensors",
    ]
    lines = ["READY" if all(p.exists() and p.stat().st_size > 1000 for p in checks) else "PARTIAL", ""]
    for p in checks:
        sz = p.stat().st_size if p.exists() else 0
        lines.append(f"{'OK' if sz > 1000 else 'MISS':4} {p.name} {sz}")
    STATUS.write_text("\n".join(lines) + "\n", encoding="utf-8")
    log("STATUS written")
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
    with sftp.file("/tmp/install_missing_models.py", "w") as f:
        f.write(REMOTE)
    sftp.close()
    stdin, stdout, stderr = c.exec_command(
        "nohup /work/ai/venv/bin/python3 -u /tmp/install_missing_models.py "
        ">/work/INSTALL_MISSING_MODELS.nohup 2>&1 & echo PID=$!; sleep 3; "
        "pgrep -af install_missing_models; head -n 25 /work/INSTALL_MISSING_MODELS.log",
        get_pty=True,
        timeout=40,
    )
    print(stdout.read().decode("utf-8", errors="replace"))
    c.close()


if __name__ == "__main__":
    main()
