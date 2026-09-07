#!/usr/bin/env python3
from pathlib import Path
import paramiko
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (2).txt")

REMOTE = r'''#!/bin/bash
set -e
DEST=/work/ComfyUI/models/mmaudio/nvidia/bigvgan_v2_44khz_128band_512x
mkdir -p "$DEST/alias_free_activation/cuda" "$DEST/alias_free_activation/torch"
HF_IP=$(getent ahostsv4 huggingface.co | awk '{print $1; exit}')
echo HF_IP=$HF_IP
RESOLVE=(--resolve "huggingface.co:443:$HF_IP")
# also resolve cdn - get IP for cdn-lfs
CDN_IP=$(getent ahostsv4 cdn-lfs.huggingface.co 2>/dev/null | awk '{print $1; exit}')
[ -n "$CDN_IP" ] && RESOLVE+=(--resolve "cdn-lfs.huggingface.co:443:$CDN_IP")
echo CDN_IP=$CDN_IP

dl() {
  local rel="$1"
  local min="${2:-100}"
  local out="$DEST/$rel"
  mkdir -p "$(dirname "$out")"
  if [ -f "$out" ] && [ "$(stat -c%s "$out")" -ge "$min" ]; then
    echo "OK $rel $(stat -c%s "$out")"
    return 0
  fi
  echo "DL $rel"
  curl -L --http1.1 --retry 6 --retry-delay 2 -C - "${RESOLVE[@]}" \
    -o "${out}.part" \
    "https://huggingface.co/nvidia/bigvgan_v2_44khz_128band_512x/resolve/main/$rel"
  mv "${out}.part" "$out"
  echo "OK $rel $(stat -c%s "$out")"
}

# essential non-LFS / small + generator already ok
dl config.json 100
dl bigvgan_generator.pt 100000000
dl bigvgan.py 1000
dl activations.py 1000
dl env.py 100
dl utils.py 100
dl meldataset.py 100
# alias free activation python bits often needed
dl alias_free_activation/__init__.py 1 || true
dl alias_free_activation/torch/__init__.py 1 || true
dl alias_free_activation/torch/act.py 100 || true
dl alias_free_activation/torch/anti_alias_activation.py 100 || true
dl alias_free_activation/torch/resample.py 100 || true
dl alias_free_activation/cuda/__init__.py 1 || true
dl alias_free_activation/cuda/anti_alias_activation.cpp 100 || true
dl alias_free_activation/cuda/anti_alias_activation_cuda.cu 100 || true
dl alias_free_activation/cuda/anti_alias_activation.py 100 || true
dl alias_free_activation/cuda/compat.h 10 || true
dl alias_free_activation/cuda/load.py 100 || true
dl alias_free_activation/cuda/type_shim.h 10 || true

# Patch FeatureUtilsLoader to never Hub-download if generator exists
NODES=/work/ComfyUI/custom_nodes/ComfyUI-MMAudio/nodes.py
cp -n "$NODES" "${NODES}.bak" || true
/work/ai/venv/bin/python3 - <<'PY'
from pathlib import Path
p = Path("/work/ComfyUI/custom_nodes/ComfyUI-MMAudio/nodes.py")
t = p.read_text(encoding="utf-8")
old = '''        nvidia_bigvgan_vocoder_path = os.path.join(download_path, "nvidia", "bigvgan_v2_44khz_128band_512x")

        if mode == "44k":
            if not os.path.exists(nvidia_bigvgan_vocoder_path):
                log.info(f"Downloading nvidia bigvgan vocoder model to: {nvidia_bigvgan_vocoder_path}")
                from huggingface_hub import snapshot_download

                snapshot_download(
                    repo_id="nvidia/bigvgan_v2_44khz_128band_512x",
                    allow_patterns=["*config.json", "*.json", "*.py", "*.pt"],
                    local_dir=nvidia_bigvgan_vocoder_path,
                )
            bigvgan_vocoder = BigVGANv2.from_pretrained(nvidia_bigvgan_vocoder_path).eval().to(device=device, dtype=dtype)'''

# more flexible replace
import re
pat = r'nvidia_bigvgan_vocoder_path = os\.path\.join\(download_path, "nvidia", "bigvgan_v2_44khz_128band_512x"\).*?bigvgan_vocoder = BigVGANv2\.from_pretrained\(nvidia_bigvgan_vocoder_path\)\.eval\(\)\.to\(device=device, dtype=dtype\)'
repl = '''nvidia_bigvgan_vocoder_path = os.path.join(download_path, "nvidia", "bigvgan_v2_44khz_128band_512x")

        if mode == "44k":
            gen_pt = os.path.join(nvidia_bigvgan_vocoder_path, "bigvgan_generator.pt")
            if not os.path.isfile(gen_pt):
                raise FileNotFoundError(
                    f"Missing local BigVGAN at {gen_pt}. Pre-download nvidia/bigvgan_v2_44khz_128band_512x "
                    f"(HF DNS often broken on this host)."
                )
            log.info(f"Loading local nvidia bigvgan vocoder from: {nvidia_bigvgan_vocoder_path}")
            bigvgan_vocoder = BigVGANv2.from_pretrained(nvidia_bigvgan_vocoder_path).eval().to(device=device, dtype=dtype)'''
nt, n = re.subn(pat, repl, t, count=1, flags=re.S)
if n != 1:
    print("PATCH_FAIL", n)
    # try simpler: comment snapshot_download block by forcing exists check on generator
    if "Missing local BigVGAN" not in t:
        t2 = t.replace(
            "if not os.path.exists(nvidia_bigvgan_vocoder_path):",
            "if not os.path.isfile(os.path.join(nvidia_bigvgan_vocoder_path, \"bigvgan_generator.pt\")):",
        )
        # and replace snapshot_download with raise
        t2 = t2.replace(
            """                log.info(f"Downloading nvidia bigvgan vocoder model to: {nvidia_bigvgan_vocoder_path}")
                from huggingface_hub import snapshot_download

                snapshot_download(
                    repo_id="nvidia/bigvgan_v2_44khz_128band_512x",
                    allow_patterns=["*config.json", "*.json", "*.py", "*.pt"],
                    local_dir=nvidia_bigvgan_vocoder_path,
                )""",
            """                raise FileNotFoundError(
                    f"Missing local BigVGAN generator at {nvidia_bigvgan_vocoder_path}/bigvgan_generator.pt"
                )""",
        )
        p.write_text(t2, encoding="utf-8")
        print("PATCH_SIMPLE_OK")
    else:
        print("already patched")
else:
    p.write_text(nt, encoding="utf-8")
    print("PATCH_OK")
PY

echo "=== files ==="
find "$DEST" -type f -printf '%s\t%p\n' | sort -n | tail -40

# quick load test
cd /work/ComfyUI
/work/ai/venv/bin/python3 - <<'PY'
import sys
sys.path.insert(0, "/work/ComfyUI/custom_nodes/ComfyUI-MMAudio")
from mmaudio.ext.bigvgan_v2.bigvgan import BigVGAN as BigVGANv2
p = "/work/ComfyUI/models/mmaudio/nvidia/bigvgan_v2_44khz_128band_512x"
m = BigVGANv2.from_pretrained(p)
print("LOAD_OK", type(m))
PY

echo DONE
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=40, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()
with sftp.file("/tmp/finish_bigvgan.sh", "w") as f:
    f.write(REMOTE)
sftp.chmod("/tmp/finish_bigvgan.sh", 0o755)
sftp.close()
_, so, se = c.exec_command("bash /tmp/finish_bigvgan.sh", timeout=300)
print(so.read().decode())
err = se.read().decode()
if err.strip():
    print("ERR", err[-2500:])
c.close()
