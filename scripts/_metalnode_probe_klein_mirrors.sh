#!/bin/bash
export PATH=/work/ai/venv/bin:/usr/bin:/bin
echo ===DNS===
getent ahostsv4 huggingface.co | head -3
getent ahostsv4 us.aws.cdn.hf.co | head -3
getent ahostsv4 hf-mirror.com | head -3
echo ===SPIDER===
wget -4 -S --spider "https://hf-mirror.com/titomatus0203/flux-2-klein-9b-fp8/resolve/main/flux-2-klein-9b-fp8.safetensors" 2>&1 | head -30
echo ===SPIDER2===
wget -4 -S --spider "https://huggingface.co/titomatus0203/flux-2-klein-9b-fp8/resolve/main/flux-2-klein-9b-fp8.safetensors" 2>&1 | head -30
echo ===MIRRORS===
python3 <<'PY'
from huggingface_hub import HfApi, list_repo_files
api=HfApi()
expect="865ba09f5b4c3cbd3468a4bd3acb9fcb2f8740c54317482f0bcd4ed1d3655cee"
for m in api.list_models(search="flux-2-klein-9b-fp8", limit=40):
  try:
    files=list_repo_files(m.id)
    for f in files:
      if not f.endswith(".safetensors"): continue
      if "fp8" not in f.lower() or "base" in f.lower(): continue
      info=api.get_paths_info(m.id,[f])[0]
      lfs=getattr(info,"lfs",None)
      sha=getattr(lfs,"sha256",None) if lfs else None
      if sha==expect or info.size==9433061528:
        print("HIT", m.id, f, info.size, sha)
  except Exception:
    pass
PY
