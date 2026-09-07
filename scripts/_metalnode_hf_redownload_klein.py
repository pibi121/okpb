#!/usr/bin/env python3
import os
import shutil
import hashlib
import glob
from pathlib import Path

os.environ["HF_HUB_DISABLE_XET"] = "1"
os.environ["HF_HUB_ENABLE_HF_TRANSFER"] = "0"

from huggingface_hub import hf_hub_download

EXPECT = "865ba09f5b4c3cbd3468a4bd3acb9fcb2f8740c54317482f0bcd4ed1d3655cee"
DEST = Path("/work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors")

print("START", flush=True)

for g in glob.glob("/work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8*"):
    p = Path(g)
    print("rm", p, flush=True)
    try:
        p.unlink()
    except Exception as e:
        print("skip", p, e, flush=True)

path = hf_hub_download(
    repo_id="titomatus0203/flux-2-klein-9b-fp8",
    filename="flux-2-klein-9b-fp8.safetensors",
    local_dir="/tmp/klein_hf_dl",
)
print("downloaded", path, flush=True)

h = hashlib.sha256()
with open(path, "rb") as f:
    while True:
        b = f.read(8 * 1024 * 1024)
        if not b:
            break
        h.update(b)
sha = h.hexdigest()
print("sha", sha, flush=True)
assert sha == EXPECT, (sha, EXPECT)

shutil.copy2(path, DEST)
print("copied", DEST.stat().st_size, flush=True)

alias = DEST.with_name("flux-2-klein-9b.safetensors")
if alias.exists() or alias.is_symlink():
    alias.unlink()
alias.symlink_to(DEST.name)
print("READY", flush=True)
