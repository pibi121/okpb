#!/usr/bin/env python3
"""Patch All-in-One workflow model paths + check disk; download face detector if easy."""
import json
import os
import time

import paramiko

PASSWORD = os.environ.get("GPUGO_PASS") or "C5FdcIQ5"
OUT = os.path.join(os.path.dirname(__file__), "_models_fix_out.txt")


def connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    for i in range(8):
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


def run(cmd, timeout=900):
    c = connect()
    try:
        print(">>>", cmd[:140].replace("\n", " "), flush=True)
        _, stdout, stderr = c.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode(errors="replace")
        err = stderr.read().decode(errors="replace")
        with open(OUT, "a", encoding="utf-8") as f:
            f.write("\n===== CMD =====\n" + cmd[:500] + "\n" + out)
            if err:
                f.write("\n--- ERR ---\n" + err)
        print((out or "")[-2500:], flush=True)
        return out
    finally:
        c.close()


open(OUT, "w", encoding="utf-8").write("start\n")

# 1) Inventory models on disk
run(
    r'''
echo "=== diffusion ==="
ls -lh /workspace/models/diffusion_models/ 2>/dev/null | head -40
echo "=== vae ==="
ls -lh /workspace/models/vae/ 2>/dev/null | head -40
echo "=== loras ==="
find /workspace/models/loras -type f 2>/dev/null | head -40
echo "=== ultralytics ==="
find /workspace/models -iname '*yolo*' -o -iname '*pussy*' -o -iname '*nipple*' -o -path '*/ultralytics/*' 2>/dev/null | head -40
echo "=== sam ==="
find /workspace/models -iname 'sam*' 2>/dev/null | head -20
echo "=== seedvr / ema ==="
find /workspace/models -iname '*ema*' -o -iname '*seedvr*' 2>/dev/null | head -30
df -h /workspace | tail -1
'''
)

# 2) Patch all copies of All-in-One workflow
run(
    r'''
python3 << 'PY'
import json, os, glob, copy

WF_GLOBS = [
  "/workspace/user/default/workflows/*ALLinONE*.json",
  "/workspace/user/default/workflows/*AllinOne*.json",
  "/opt/ComfyUI/user/default/workflows/*ALLinONE*.json",
]

# replacements for string widget values
REPL = {
  "z-image-turbo-fp8-e4m3fn.safetensors": "z_image_turbo_bf16.safetensors",
  "z-image-turbo-fp8.safetensors": "z_image_turbo_bf16.safetensors",
  "ultrafluxVAEImproved_v10.safetensors": "ae.safetensors",
  "ultrafluxVAEImproved.safetensors": "ae.safetensors",
}

# LoRA files that don't exist - clear / neutralize
MISSING_LORA_SUBSTR = [
  "Detailed_Nipples",
  "Detailed_nipples",
  "Detailed nipples",
]

# Node types to force Bypass (mode=4) for first-run friendliness when models missing
# mode: 0=always, 2=mute, 4=bypass
BYPASS_TYPES = {
  "UltralyticsDetectorProvider",
  "ImpactSimpleDetectorSEGS",
  "SAMLoader",
  "FaceDetailer",
  "FaceDetailerPipe",
  "SeedVR2VideoUpscaler",
  "SeedVR2LoadDiTModel",
  "SeedVR2LoadVAEModel",
}

# Also bypass by title keywords
BYPASS_TITLE_KW = ["nipple", "pussy", "detailer", "seedvr", "upscale"]

def patch_widgets(obj, changes):
  if isinstance(obj, list):
    for i, v in enumerate(obj):
      if isinstance(v, str):
        nv = REPL.get(v, v)
        # also case-insensitive / prefix match for truncated names
        for old, new in REPL.items():
          if v == old or v.startswith(old.split(".")[0]):
            nv = new
        if nv != v:
          obj[i] = nv
          changes.append(f"widget {v} -> {nv}")
        # clear missing loras
        for sub in MISSING_LORA_SUBSTR:
          if sub.lower() in v.lower() and v.endswith((".safetensors", ".pt", ".ckpt")):
            obj[i] = "None" if False else ""
            # Power Lora uses dicts often - handled below
            changes.append(f"cleared lora path {v}")
      else:
        patch_widgets(v, changes)
  elif isinstance(obj, dict):
    # Power Lora stack entries
    if "lora" in obj and isinstance(obj["lora"], str):
      lv = obj["lora"]
      for sub in MISSING_LORA_SUBSTR:
        if sub.lower() in lv.lower():
          obj["on"] = False
          changes.append(f"disabled power-lora {lv}")
    for k, v in list(obj.items()):
      patch_widgets(v, changes)

def should_bypass(node):
  t = node.get("type") or ""
  title = (node.get("title") or "").lower()
  if t in BYPASS_TYPES:
    return True
  if any(k in title for k in BYPASS_TITLE_KW):
    # don't bypass Save or core loaders accidentally
    if t in ("UNETLoader", "VAELoader", "CLIPLoader", "DualCLIPLoader", "EmptySD3LatentImage", "KSampler", "KSamplerAdvanced", "SaveImage", "FluxResolutionNode", "ttN text"):
      return False
    return True
  # Ultralytics widget paths
  w = node.get("widgets_values")
  blob = json.dumps(w, ensure_ascii=False) if w is not None else ""
  if "bbox/pussy" in blob or "bbox/nipples" in blob or "ema_vae" in blob:
    return True
  if "Detailed_nipples" in blob or "Detailed_Nipples" in blob:
    return True
  return False

paths = []
for g in WF_GLOBS:
  paths.extend(glob.glob(g))
paths = sorted(set(paths))
print("files", paths)

for p in paths:
  d = json.load(open(p, encoding="utf-8"))
  changes = []
  for n in d.get("nodes") or []:
    # patch widgets
    if "widgets_values" in n:
      before = json.dumps(n["widgets_values"], ensure_ascii=False)
      patch_widgets(n["widgets_values"], changes)
    # UNETLoader / VAELoader explicit
    t = n.get("type")
    w = n.get("widgets_values")
    if t in ("UNETLoader", "UNETLoaderGGUF") and isinstance(w, list) and w:
      if "fp8" in str(w[0]).lower() or "z-image-turbo" in str(w[0]).lower():
        if w[0] != "z_image_turbo_bf16.safetensors":
          changes.append(f"node{n.get('id')} UNET {w[0]} -> bf16")
          w[0] = "z_image_turbo_bf16.safetensors"
    if t == "VAELoader" and isinstance(w, list) and w:
      if "ultraflux" in str(w[0]).lower() or w[0] != "ae.safetensors":
        if "ultraflux" in str(w[0]).lower():
          changes.append(f"node{n.get('id')} VAE {w[0]} -> ae")
          w[0] = "ae.safetensors"
    # LoraLoader clear missing
    if t in ("LoraLoader", "LoraLoaderModelOnly") and isinstance(w, list) and w:
      if any(s.lower() in str(w[0]).lower() for s in MISSING_LORA_SUBSTR):
        changes.append(f"node{n.get('id')} bypass LoraLoader {w[0]}")
        n["mode"] = 4
    # Force bypass heavy missing-model branches
    if should_bypass(n) and n.get("mode", 0) != 4:
      changes.append(f"bypass node{n.get('id')} {t} {n.get('title')}")
      n["mode"] = 4  # Bypass

  # Also bypass groups by title
  for g in d.get("groups") or []:
    title = (g.get("title") or "").lower()
    if any(k in title for k in ("nipple", "pussy", "seedvr", "detailer", "upscale", "face")):
      # groups don't have mode in all versions; nodes already bypassed
      changes.append(f"group noted {g.get('title')}")

  json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False)
  print("PATCHED", p, "changes", len(changes))
  for c in changes[:60]:
    print(" ", c)
  if len(changes) > 60:
    print("  ...", len(changes)-60, "more")
PY
'''
)

# 3) Try download standard face_yolov8m + sam if missing (helpful); NSFW detectors from civitai often need auth - skip or search
run(
    r'''
set -e
mkdir -p /workspace/models/ultralytics/bbox /workspace/models/sams /workspace/models/vae
# face detector commonly used by Impact
FACE_URL="https://huggingface.co/Bingsu/adetailer/resolve/main/face_yolov8m.pt"
if [ ! -f /workspace/models/ultralytics/bbox/face_yolov8m.pt ]; then
  echo "DL face_yolov8m"
  wget -q --show-progress -O /workspace/models/ultralytics/bbox/face_yolov8m.pt "$FACE_URL" || curl -L -o /workspace/models/ultralytics/bbox/face_yolov8m.pt "$FACE_URL" || echo FAIL_FACE
fi
# SAM vit_b
SAM_URL="https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth"
if [ ! -f /workspace/models/sams/sam_vit_b_01ec64.pth ]; then
  echo "DL sam_vit_b"
  wget -q --show-progress -O /workspace/models/sams/sam_vit_b_01ec64.pth "$SAM_URL" || curl -L -o /workspace/models/sams/sam_vit_b_01ec64.pth "$SAM_URL" || echo FAIL_SAM
fi
ls -lh /workspace/models/ultralytics/bbox/ /workspace/models/sams/ 2>/dev/null | head -30
'''
, timeout=600)

# 4) Write status
run(
    r'''
cat > /workspace/ALLINONE_STATUS.txt << 'EOF'
All-in-One READY for first gen

Patched workflow:
- UNET -> z_image_turbo_bf16.safetensors
- VAE  -> ae.safetensors
- Bypassed: SeedVR, FaceDetailer/nipple/pussy detectors, missing nipple LoRAs

Do:
1. Ctrl+F5
2. Workflow -> Open -> Z-Image-ALLinONE-v2
3. Queue Prompt

Later: re-enable FaceDetailer after detectors; SeedVR after weights.
EOF
cat /workspace/ALLINONE_STATUS.txt

python3 << 'PY'
import json, glob
for p in glob.glob('/workspace/user/default/workflows/*ALLinONE*.json'):
  d=json.load(open(p,encoding='utf-8'))
  modes={}
  for n in d['nodes']:
    t=n.get('type'); m=n.get('mode',0)
    w=n.get('widgets_values')
    if t in ('UNETLoader','VAELoader') or (isinstance(w,list) and w and isinstance(w[0],str) and w[0].endswith(('.safetensors','.pt'))):
      print(p.split('/')[-1], 'id', n['id'], t, 'mode', m, 'w0', (w[0] if isinstance(w,list) and w else None))
  bypassed=[n for n in d['nodes'] if n.get('mode')==4]
  print('bypassed_count', len(bypassed), [ (n['id'], n.get('type'), n.get('title')) for n in bypassed[:25]])
PY
'''
)
print("DONE")
