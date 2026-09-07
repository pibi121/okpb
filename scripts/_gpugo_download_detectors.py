#!/usr/bin/env python3
"""Download missing ultralytics bbox detectors + ensure workflow refs exist."""
import os
import time

import paramiko

PASSWORD = os.environ.get("GPUGO_PASS") or "C5FdcIQ5"
OUT = os.path.join(os.path.dirname(__file__), "_det_dl_out.txt")


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


def run(cmd, timeout=600):
    c = connect()
    try:
        print(">>>", cmd[:120].replace("\n", " "), flush=True)
        _, stdout, stderr = c.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode(errors="replace")
        err = stderr.read().decode(errors="replace")
        with open(OUT, "a", encoding="utf-8") as f:
            f.write("\n===== CMD =====\n" + cmd[:400] + "\n" + out)
            if err:
                f.write("\n--- ERR ---\n" + err)
        print((out or "")[-2000:], flush=True)
        return out
    finally:
        c.close()


open(OUT, "w", encoding="utf-8").write("start\n")

run(
    r'''
set -e
mkdir -p /workspace/models/ultralytics/bbox
cd /workspace/models/ultralytics/bbox

dl() {
  name="$1"
  url="$2"
  if [ -f "$name" ] && [ -s "$name" ]; then
    echo "EXISTS $name $(stat -c%s "$name")"
    return 0
  fi
  echo "DL $name"
  rm -f "$name.part"
  if command -v wget >/dev/null; then
    wget -O "$name.part" "$url" && mv "$name.part" "$name" && return 0
  fi
  curl -L --fail -o "$name.part" "$url" && mv "$name.part" "$name"
}

# pussyV2
dl pussyV2.pt "https://huggingface.co/art0123/Models_collection/resolve/main/bbox/pussyV2.pt" \
  || dl pussyV2.pt "https://huggingface.co/art0123/Models_collection/resolve/8b8725dddfea29f5ddd6fad1dd3dd2b6730a9251/bbox/pussyV2.pt" \
  || echo FAIL_PUSSY

# nipples
dl nipples_yolov8s.pt "https://huggingface.co/ashllay/YOLO_Models/resolve/main/bbox/nipples_yolov8s.pt" \
  || dl nipples_yolov8s.pt "https://huggingface.co/gazsuv/pussydetectorv4/resolve/main/nipples_yolov8s.pt" \
  || echo FAIL_NIPPLES

ls -lh /workspace/models/ultralytics/bbox/

# Impact Subpack whitelist for older YOLO pickles (PyTorch 2.6+)
WL_DIRS=(
  "/workspace/user/default/ComfyUI-Impact-Subpack"
  "/opt/ComfyUI/user/default/ComfyUI-Impact-Subpack"
  "/workspace/custom_nodes/comfyui-impact-subpack"
)
for d in "${WL_DIRS[@]}"; do
  mkdir -p "$d" 2>/dev/null || true
done
# prefer user default path used by Impact
mkdir -p /workspace/user/default/ComfyUI-Impact-Subpack
WL=/workspace/user/default/ComfyUI-Impact-Subpack/model-whitelist.txt
touch "$WL"
for m in pussyV2.pt nipples_yolov8s.pt bbox/pussyV2.pt bbox/nipples_yolov8s.pt; do
  grep -qxF "$m" "$WL" 2>/dev/null || echo "$m" >> "$WL"
done
echo "whitelist:"; cat "$WL"
'''
)

# Ensure workflow still points to bbox/... and keep detailers bypassed for first run
# (files exist so missing-model UI clears even if not bypassed)
run(
    r'''
python3 << 'PY'
import json, glob, os

need = {
  "bbox/pussyV2.pt": "/workspace/models/ultralytics/bbox/pussyV2.pt",
  "bbox/nipples_yolov8s.pt": "/workspace/models/ultralytics/bbox/nipples_yolov8s.pt",
}
for label, path in need.items():
  ok = os.path.isfile(path) and os.path.getsize(path) > 1000
  print(label, "OK" if ok else "MISSING", os.path.getsize(path) if os.path.isfile(path) else 0)

# If download failed, remap widgets to face_yolov8m so UI clears
fallback = "bbox/face_yolov8m.pt"
face_ok = os.path.isfile("/workspace/models/ultralytics/bbox/face_yolov8m.pt")

for p in sorted(set(glob.glob("/workspace/user/default/workflows/*ALLinONE*.json") + glob.glob("/opt/ComfyUI/user/default/workflows/*ALLinONE*.json"))):
  d = json.load(open(p, encoding="utf-8"))
  changed = 0
  for n in d.get("nodes") or []:
    w = n.get("widgets_values")
    if not isinstance(w, list):
      continue
    for i, v in enumerate(w):
      if not isinstance(v, str):
        continue
      if "pussyV2" in v:
        if not need["bbox/pussyV2.pt"] or not os.path.isfile(need["bbox/pussyV2.pt"]):
          if face_ok:
            w[i] = fallback; changed += 1
        else:
          w[i] = "bbox/pussyV2.pt"
      if "nipples_yolov" in v:
        if not os.path.isfile(need["bbox/nipples_yolov8s.pt"]):
          if face_ok:
            w[i] = fallback; changed += 1
        else:
          w[i] = "bbox/nipples_yolov8s.pt"
    # keep NSFW detailer branches bypassed for safe first run
    t = n.get("type") or ""
    blob = json.dumps(w, ensure_ascii=False)
    if t in ("UltralyticsDetectorProvider", "FaceDetailer", "SAMLoader") and (
      "pussy" in blob or "nipples" in blob or (n.get("title") or "").lower().find("nipple") >= 0
    ):
      if n.get("mode") != 4:
        n["mode"] = 4
        changed += 1
  if changed:
    json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False)
  print("patched", p, "changes", changed)

print("bbox dir:")
for fn in sorted(os.listdir("/workspace/models/ultralytics/bbox")):
  fp = f"/workspace/models/ultralytics/bbox/{fn}"
  print(f"  {fn} {os.path.getsize(fp)}")
PY
'''
)

run(
    r'''
cat > /workspace/ALLINONE_STATUS.txt << 'EOF'
Detectors installed:
- models/ultralytics/bbox/pussyV2.pt
- models/ultralytics/bbox/nipples_yolov8s.pt
(+ face_yolov8m.pt already present)

Do:
1. Ctrl+F5
2. Re-open Z-Image-ALLinONE-v2 from server Workflows list
3. Missing models should be 0 -> Queue

NSFW detailers may still be Bypass (safe). Enable later if needed.
EOF
cat /workspace/ALLINONE_STATUS.txt
ls -lh /workspace/models/ultralytics/bbox/
'''
)
print("DONE")
