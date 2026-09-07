#!/usr/bin/env python3
from pathlib import Path
import paramiko
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (2).txt")

PATCH = r'''
from pathlib import Path
p = Path("/work/ComfyUI/custom_nodes/ComfyUI-MMAudio/nodes.py")
t = p.read_text(encoding="utf-8")
old = """        nvidia_bigvgan_vocoder_path = os.path.join(download_path, "nvidia", "bigvgan_v2_44khz_128band_512x")
        if mode == "44k":
            if not os.path.exists(nvidia_bigvgan_vocoder_path):
                log.info(f"Downloading nvidia bigvgan vocoder model to: {nvidia_bigvgan_vocoder_path}")
                from huggingface_hub import snapshot_download

                snapshot_download(
                    repo_id="nvidia/bigvgan_v2_44khz_128band_512x",
                    ignore_patterns=["*3m*",],
                    local_dir=nvidia_bigvgan_vocoder_path,
                    local_dir_use_symlinks=False,
                )
            
            bigvgan_vocoder = BigVGANv2.from_pretrained(nvidia_bigvgan_vocoder_path).eval().to(device=device, dtype=dtype)"""

new = """        nvidia_bigvgan_vocoder_path = os.path.join(download_path, "nvidia", "bigvgan_v2_44khz_128band_512x")
        if mode == "44k":
            gen_pt = os.path.join(nvidia_bigvgan_vocoder_path, "bigvgan_generator.pt")
            if not os.path.isfile(gen_pt):
                raise FileNotFoundError(
                    f"Missing local BigVGAN at {gen_pt} (HF download disabled on this host)"
                )
            log.info(f"Loading local nvidia bigvgan from: {nvidia_bigvgan_vocoder_path}")
            bigvgan_vocoder = BigVGANv2.from_pretrained(nvidia_bigvgan_vocoder_path).eval().to(device=device, dtype=dtype)"""

if "Missing local BigVGAN at" in t:
    print("already_patched")
elif old not in t:
    print("OLD_NOT_FOUND")
    # show nearby
    i = t.find("nvidia_bigvgan_vocoder_path")
    print(repr(t[i:i+500]))
else:
    p.write_text(t.replace(old, new, 1), encoding="utf-8")
    print("patched_ok")
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=40, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()
with sftp.file("/tmp/patch_mmaudio.py", "w") as f:
    f.write(PATCH)
sftp.close()
_, so, se = c.exec_command("/work/ai/venv/bin/python3 /tmp/patch_mmaudio.py", timeout=30)
print(so.read().decode())
print(se.read().decode())
# soft note: comfy may already work without restart since load is at runtime from disk
_, so, _ = c.exec_command(
    "ls -lh /work/ComfyUI/models/mmaudio/nvidia/bigvgan_v2_44khz_128band_512x/bigvgan_generator.pt "
    "/work/ComfyUI/models/mmaudio/nvidia/bigvgan_v2_44khz_128band_512x/config.json; "
    "curl -s -o /dev/null -w 'comfy=%{http_code}\\n' http://127.0.0.1:8188/",
    timeout=20,
)
print(so.read().decode())
c.close()
