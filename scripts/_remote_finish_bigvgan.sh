#!/bin/bash
set -e
DEST=/work/ComfyUI/models/mmaudio/nvidia/bigvgan_v2_44khz_128band_512x
mkdir -p "$DEST/alias_free_activation/cuda" "$DEST/alias_free_activation/torch"
HF_IP=$(getent ahostsv4 huggingface.co | awk '{print $1; exit}')
echo HF_IP=$HF_IP
CDN_IP=$(getent ahostsv4 cdn-lfs.huggingface.co 2>/dev/null | awk '{print $1; exit}')
echo CDN_IP=$CDN_IP

RESOLVE_ARGS=(--resolve "huggingface.co:443:${HF_IP}")
if [ -n "$CDN_IP" ]; then
  RESOLVE_ARGS+=(--resolve "cdn-lfs.huggingface.co:443:${CDN_IP}")
fi

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
  curl -L --http1.1 --retry 6 --retry-delay 2 -C - "${RESOLVE_ARGS[@]}" \
    -o "${out}.part" \
    "https://huggingface.co/nvidia/bigvgan_v2_44khz_128band_512x/resolve/main/$rel"
  mv "${out}.part" "$out"
  echo "OK $rel $(stat -c%s "$out")"
}

dl config.json 100
dl bigvgan_generator.pt 100000000
dl bigvgan.py 1000
dl activations.py 1000
dl env.py 100
dl utils.py 100
dl meldataset.py 100
dl alias_free_activation/__init__.py 1 || true
dl alias_free_activation/torch/__init__.py 1 || true
dl alias_free_activation/torch/act.py 100 || true
dl alias_free_activation/torch/anti_alias_activation.py 100 || true
dl alias_free_activation/torch/resample.py 100 || true
dl alias_free_activation/cuda/__init__.py 1 || true
dl alias_free_activation/cuda/anti_alias_activation.cpp 100 || true
dl alias_free_activation/cuda/anti_alias_activation_cuda.cu 100 || true
dl alias_free_activation/cuda/activation1d.py 100 || true
dl alias_free_activation/cuda/load.py 100 || true
dl alias_free_activation/cuda/compat.h 10 || true
dl alias_free_activation/cuda/type_shim.h 10 || true

# Patch nodes.py offline
NODES=/work/ComfyUI/custom_nodes/ComfyUI-MMAudio/nodes.py
cp -n "$NODES" "${NODES}.bak" 2>/dev/null || true
python3 << 'PY'
from pathlib import Path
p = Path("/work/ComfyUI/custom_nodes/ComfyUI-MMAudio/nodes.py")
t = p.read_text(encoding="utf-8")
if "Missing local BigVGAN generator" in t:
    print("already patched")
else:
    a = 'if not os.path.exists(nvidia_bigvgan_vocoder_path):'
    b = 'if not os.path.isfile(os.path.join(nvidia_bigvgan_vocoder_path, "bigvgan_generator.pt")):'
    if a not in t:
        raise SystemExit("anchor1 missing")
    t = t.replace(a, b, 1)
    old = '''                log.info(f"Downloading nvidia bigvgan vocoder model to: {nvidia_bigvgan_vocoder_path}")
                from huggingface_hub import snapshot_download

                snapshot_download(
                    repo_id="nvidia/bigvgan_v2_44khz_128band_512x",
                    allow_patterns=["*config.json", "*.json", "*.py", "*.pt"],
                    local_dir=nvidia_bigvgan_vocoder_path,
                )'''
    new = '''                raise FileNotFoundError(
                    f"Missing local BigVGAN generator at {nvidia_bigvgan_vocoder_path}/bigvgan_generator.pt"
                )'''
    if old not in t:
        # looser: remove snapshot_download call block by regex
        import re
        t2, n = re.subn(
            r'log\.info\(f"Downloading nvidia bigvgan.*?\n(?:.*\n){0,8}?snapshot_download\([\s\S]*?\)\n',
            'raise FileNotFoundError(f"Missing local BigVGAN generator at {nvidia_bigvgan_vocoder_path}/bigvgan_generator.pt")\n',
            t,
            count=1,
        )
        if n != 1:
            raise SystemExit(f"anchor2 missing n={n}")
        t = t2
        print("PATCH_REGEX_OK")
    else:
        t = t.replace(old, new, 1)
        print("PATCH_OK")
    p.write_text(t, encoding="utf-8")
PY

echo "=== files ==="
find "$DEST" -type f -printf '%s\t%p\n' | sort -n

cd /work/ComfyUI
/work/ai/venv/bin/python3 << 'PY'
import sys
sys.path.insert(0, "/work/ComfyUI/custom_nodes/ComfyUI-MMAudio")
from mmaudio.ext.bigvgan_v2.bigvgan import BigVGAN as BigVGANv2
p = "/work/ComfyUI/models/mmaudio/nvidia/bigvgan_v2_44khz_128band_512x"
m = BigVGANv2.from_pretrained(p)
print("LOAD_OK", type(m))
PY

# restart comfy to pick patch
pkill -9 -f '/work/ComfyUI/main.py' || true
sleep 2
cd /work/ComfyUI
nohup /work/ai/venv/bin/python3 main.py --listen --port 8188 --enable-manager >/work/comfy_restart.log 2>&1 &
sleep 15
curl -s -o /dev/null -w "http=%{http_code}\n" http://127.0.0.1:8188/
echo DONE
